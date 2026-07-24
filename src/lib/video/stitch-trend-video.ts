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

async function downloadClip(url: string, filePath: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) {
    throw new Error(`clip_download_failed:${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(filePath, buffer)
}

export async function stitchTrendVideoClips(params: {
  jobId: string
  clipUrls: string[]
  durationsSec: number[]
}): Promise<string | null> {
  if (params.clipUrls.length < 2) {
    return params.clipUrls[0] ?? null
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), `trend-video-${params.jobId}-`))
  const clipPaths = params.clipUrls.map((_, index) => path.join(tmpDir, `clip-${index + 1}.mp4`))
  const outputPath = path.join(tmpDir, 'final.mp4')

  try {
    await Promise.all(params.clipUrls.map((url, index) => downloadClip(url, clipPaths[index])))

    const filterSegments = clipPaths.map((_, index) => {
      const duration = Math.max(0.9, params.durationsSec[index] || 1.5)
      const fadeInDuration = Math.min(0.08, Math.max(0.04, duration * 0.08))
      const fadeOutDuration = Math.min(0.12, Math.max(0.05, duration * 0.1))
      const fadeOutStart = Math.max(0, duration - fadeOutDuration)
      return `[${index}:v]trim=duration=${duration.toFixed(2)},setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,format=yuv420p,fade=t=in:st=0:d=${fadeInDuration.toFixed(2)},fade=t=out:st=${fadeOutStart.toFixed(2)}:d=${fadeOutDuration.toFixed(2)}[v${index}]`
    })
    const concatInputs = clipPaths.map((_, index) => `[v${index}]`).join('')
    const filterComplex = `${filterSegments.join(';')};${concatInputs}concat=n=${clipPaths.length}:v=1:a=0[outv]`

    const args = [
      '-y',
      ...clipPaths.flatMap((clipPath) => ['-i', clipPath]),
      '-filter_complex',
      filterComplex,
      '-map',
      '[outv]',
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '19',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath,
    ]

    await execFileAsync(getFfmpegPath(), args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })

    const buffer = await fs.readFile(outputPath)
    const storagePath = `trend-videos/finals/${params.jobId}.mp4`
    const supabase = getAdminClient()
    const { error } = await supabase.storage.from('reels').upload(storagePath, buffer, {
      contentType: 'video/mp4',
      upsert: true,
    })

    if (error) {
      throw new Error(`trend_video_upload_failed:${error.message}`)
    }

    return supabase.storage.from('reels').getPublicUrl(storagePath).data.publicUrl
  } catch (error) {
    console.error('[trend-video] stitch failed:', error instanceof Error ? error.message : error)
    return null
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}
