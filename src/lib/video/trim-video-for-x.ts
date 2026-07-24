import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ffmpegStatic from 'ffmpeg-static'
import { getAdminClient } from '@/lib/supabase/admin'

const execFileAsync = promisify(execFile)

function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'
}

async function downloadVideo(url: string, filePath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`video_download_failed:${res.status}`)
  const buffer = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(filePath, buffer)
}

/** ffmpeg -i sem output sempre sai com código != 0 — a duração fica no stderr do erro. */
async function getVideoDurationSec(filePath: string): Promise<number | null> {
  try {
    await execFileAsync(getFfmpegPath(), ['-i', filePath], { timeout: 15_000 })
    return null
  } catch (err) {
    const stderr = (err as { stderr?: string })?.stderr || ''
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
    if (!match) return null
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  }
}

const X_VIDEO_MAX_DURATION_SEC = 120
const X_VIDEO_TRIM_TARGET_SEC = 115 // folga de 5s abaixo do limite real do X

/**
 * X rejeita vídeo com mais de 2 minutos (contas não-premium) com HTTP 403 "not allowed to
 * post a video longer than 2 minutes" — achado real em produção (~6% das falhas de
 * publicação no X, 21/07/2026). Corta pra X_VIDEO_TRIM_TARGET_SEC só quando necessário —
 * sonda a duração primeiro via `ffmpeg -i` e nunca reencoda vídeo que já está dentro do
 * limite. Non-fatal: retorna null em qualquer falha (download, sonda, corte, upload) —
 * caller sempre cai pro vídeo original, mesmo padrão de burnSubtitlesForX.
 */
export async function trimVideoForXIfNeeded(videoUrl: string, itemId: string): Promise<string | null> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `x-trim-${itemId}-`))
  const inputPath = path.join(tmpDir, 'input.mp4')
  const outputPath = path.join(tmpDir, 'output.mp4')
  try {
    await downloadVideo(videoUrl, inputPath)
    const durationSec = await getVideoDurationSec(inputPath)
    if (durationSec === null || durationSec <= X_VIDEO_MAX_DURATION_SEC) return null

    console.warn(`[trim-video-for-x] vídeo com ${durationSec.toFixed(1)}s excede o limite do X (${X_VIDEO_MAX_DURATION_SEC}s) — cortando pra ${X_VIDEO_TRIM_TARGET_SEC}s`)
    await execFileAsync(getFfmpegPath(), [
      '-y', '-i', inputPath,
      '-t', String(X_VIDEO_TRIM_TARGET_SEC),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })

    const buffer = await fs.readFile(outputPath)
    const storagePath = `x-trimmed/${itemId}.mp4`
    const supabase = getAdminClient()
    const { error } = await supabase.storage.from('reels').upload(storagePath, buffer, {
      contentType: 'video/mp4',
      upsert: true,
    })
    if (error) throw new Error(`x_trim_upload_failed:${error.message}`)

    return supabase.storage.from('reels').getPublicUrl(storagePath).data.publicUrl
  } catch (err) {
    console.error('[trim-video-for-x] falhou:', err instanceof Error ? err.message : err)
    return null
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
