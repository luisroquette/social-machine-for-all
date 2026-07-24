import { NextResponse } from 'next/server'
import { WORKSPACE_ID } from '@/lib/config/constants'
import { isCronRequest } from '@/lib/api/auth'
import { getNumericVariable, getVariable } from '@/lib/settings/load-settings'
import { generateTrendCover } from '@/lib/ai/generate-trend-cover'
import { generateTrendImageAsset } from '@/lib/ai/generate-trend-image'
import {
  type HiggsfieldJobResult,
  isHiggsfieldConcurrencyLimitError,
  isHiggsfieldConfigured,
  isHiggsfieldTextToVideoConfigured,
  pollHiggsfieldJob,
  startHiggsfieldTextToVideoJob,
} from '@/lib/ai/higgsfield'
import { getAdminClient } from '@/lib/supabase/admin'
import { stitchTrendVideoClips } from '@/lib/video/stitch-trend-video'
import type { TablesUpdate } from '@/lib/supabase/database.types'
import {
  supportsTrendVideoGenerationMemory,
  withOptionalTrendVideoGenerationMemory,
} from '@/lib/trends/trend-video-schema'

export const maxDuration = 300
const DEFAULT_HIGGSFIELD_MAX_CONCURRENT_REQUESTS = 4
const MAX_SHOT_RETRIES = 2

type ShotStatus = 'pending' | 'rendering' | 'ready' | 'failed'
type JsonObject = Record<string, unknown>

// Vídeo é sempre text-to-video puro — 1 shot = 1 clipe, sem imagem por shot e sem
// keyframes start/end (esses só existiam para suportar image-to-video).
interface TrendShotResult {
  shotId: string
  label: string
  styleRole: string
  visualStyle: string
  styleDirection: string
  visualIntent: string
  subjectAction: string
  environmentAction: string
  cameraMove: string
  lens: string
  framing: string
  lightShift: string
  transition: string
  payoff: string
  rhythm: string
  motionPrompt: string
  durationSec: number
  index: number
  retryCount: number
  status: ShotStatus
  clipUrl: string | null
  providerJobId: string | null
  videoGeneration: JsonObject | null
  error: string | null
}

function asJsonObject(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null
}

function parseGenerationMemory(value: unknown): JsonObject {
  return asJsonObject(value) ?? {}
}

function isEnabled(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function buildModelChain(primary: string, fallbackCsv: string, hardDefaults: string[]): string[] {
  const unique = new Set<string>()
  const ordered = [primary, ...parseCsv(fallbackCsv), ...hardDefaults]
  const chain: string[] = []
  for (const model of ordered) {
    const normalized = model.trim()
    if (!normalized || unique.has(normalized)) continue
    unique.add(normalized)
    chain.push(normalized)
  }
  return chain
}

// Higgsfield seedance_2_0 aceita duration de 4 a 15s. Faixa [4,10] prioriza qualidade
// cinematográfica sem ir ao teto (custo/tempo de render). Alinhado com trend-creative.ts.
const SHOT_DURATION_MIN = 4
const SHOT_DURATION_MAX = 10

function clampShotDuration(value: number): number {
  return Math.max(SHOT_DURATION_MIN, Math.min(SHOT_DURATION_MAX, value || 6))
}

// Erro da API que indica duração fora do range aceito (fallback: tentar duração menor).
function isHiggsfieldDurationError(error: string | null | undefined): boolean {
  if (!error) return false
  const normalized = error.toLowerCase()
  return normalized.includes('duration') && (
    normalized.includes('invalid') || normalized.includes('range') ||
    normalized.includes('exceed') || normalized.includes('max') ||
    normalized.includes('min') || normalized.includes('must be')
  )
}

function enhanceMotionPrompt(prompt: string, label: string): string {
  const cleaned = prompt.trim()
  const runtimeRules = [
    `Shot ${label}.`,
    'Sem looping.',
    'Sem idle animation.',
    'Sem breathing image.',
    'Sem parallax sutil.',
    'Gerar evento visual com começo, meio e fim.',
    'O frame final deve ser visivelmente diferente do frame inicial.',
    'Priorizar acao do sujeito, reacao do ambiente, camera ativa e mudanca real de luz.',
  ].join(' ')

  return cleaned ? `${cleaned} ${runtimeRules}` : runtimeRules
}

function parseShotResults(row: {
  shot_results?: unknown
  motion_prompt?: unknown
}, defaultDurationSec: number): TrendShotResult[] {
  const raw = Array.isArray(row.shot_results) ? (row.shot_results as Array<Record<string, unknown>>) : []

  if (raw.length > 0) {
    return raw.map((shot, index) => ({
      shotId: typeof shot.shotId === 'string' ? shot.shotId : `shot_${index + 1}`,
      label: typeof shot.label === 'string' ? shot.label : `Shot ${index + 1}`,
      styleRole: typeof shot.styleRole === 'string' ? shot.styleRole : '',
      visualStyle: typeof shot.visualStyle === 'string' ? shot.visualStyle : '',
      styleDirection: typeof shot.styleDirection === 'string' ? shot.styleDirection : '',
      visualIntent: typeof shot.visualIntent === 'string' ? shot.visualIntent : '',
      subjectAction: typeof shot.subjectAction === 'string' ? shot.subjectAction : '',
      environmentAction: typeof shot.environmentAction === 'string' ? shot.environmentAction : '',
      cameraMove: typeof shot.cameraMove === 'string' ? shot.cameraMove : '',
      lens: typeof shot.lens === 'string' ? shot.lens : '',
      framing: typeof shot.framing === 'string' ? shot.framing : '',
      lightShift: typeof shot.lightShift === 'string' ? shot.lightShift : '',
      transition: typeof shot.transition === 'string' ? shot.transition : '',
      payoff: typeof shot.payoff === 'string' ? shot.payoff : '',
      rhythm: typeof shot.rhythm === 'string' ? shot.rhythm : '',
      motionPrompt: typeof shot.motionPrompt === 'string' ? shot.motionPrompt : String(row.motion_prompt ?? ''),
      durationSec: clampShotDuration(Number(shot.durationSec) || defaultDurationSec),
      index: Number(shot.index) || index,
      retryCount: Number(shot.retryCount) || 0,
      status: (typeof shot.status === 'string' ? shot.status : 'pending') as ShotStatus,
      clipUrl: typeof shot.clipUrl === 'string' ? shot.clipUrl : null,
      providerJobId: typeof shot.providerJobId === 'string' ? shot.providerJobId : null,
      videoGeneration: asJsonObject(shot.videoGeneration),
      error: typeof shot.error === 'string' ? shot.error : null,
    }))
  }

  return [
    {
      shotId: 'shot_1',
      label: 'Hero',
      styleRole: '',
      visualStyle: '',
      styleDirection: '',
      visualIntent: '',
      subjectAction: '',
      environmentAction: '',
      cameraMove: '',
      lens: '',
      framing: '',
      lightShift: '',
      transition: '',
      payoff: '',
      rhythm: '',
      motionPrompt: String(row.motion_prompt ?? ''),
      durationSec: clampShotDuration(defaultDurationSec),
      index: 0,
      retryCount: 0,
      status: 'pending',
      clipUrl: null,
      providerJobId: null,
      videoGeneration: null,
      error: null,
    },
  ]
}

function canRetryShot(shot: TrendShotResult): boolean {
  return (shot.retryCount ?? 0) < MAX_SHOT_RETRIES
}

function isShotReady(shot: TrendShotResult): boolean {
  return Boolean(shot.clipUrl)
}

function getRenderingShotJobId(shots: TrendShotResult[]): string | null {
  const shot = shots.find((item) => item.providerJobId && !item.clipUrl)
  return shot?.providerJobId ?? null
}

function countActiveRenderingShots(shots: TrendShotResult[]): number {
  return shots.filter((shot) => shot.providerJobId && !shot.clipUrl).length
}

function countActiveRenderingShotsInJobs(jobs: Array<Record<string, unknown>>): number {
  return jobs.reduce((total, job) => {
    const shots = parseShotResults(
      { shot_results: job.shot_results, motion_prompt: job.motion_prompt },
      3,
    )
    return total + countActiveRenderingShots(shots)
  }, 0)
}

function summarizeShots(shots: TrendShotResult[]): { ready: number; total: number } {
  return {
    ready: shots.filter(isShotReady).length,
    total: shots.length,
  }
}

function appendVideoAttempt(shot: TrendShotResult, attempt: JsonObject) {
  const existing = asJsonObject(shot.videoGeneration)
  const attempts = Array.isArray(existing?.attempts) ? [...existing.attempts as JsonObject[]] : []
  attempts.push(attempt)
  shot.videoGeneration = {
    ...(existing ?? {}),
    attempts,
  }
}

function updateLastVideoAttempt(shot: TrendShotResult, patch: JsonObject) {
  const existing = asJsonObject(shot.videoGeneration)
  const attempts = Array.isArray(existing?.attempts) ? [...existing.attempts as JsonObject[]] : []
  if (!attempts.length) return
  attempts[attempts.length - 1] = {
    ...(asJsonObject(attempts[attempts.length - 1]) ?? {}),
    ...patch,
  }
  shot.videoGeneration = {
    ...(existing ?? {}),
    attempts,
    ...(patch.videoUrl ? { finalUrl: patch.videoUrl } : {}),
    ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
  }
}

function buildPromptVideoPrompt(params: {
  coverTitle: string
  style: string
  angle: string
  shot: TrendShotResult
}): string {
  const base = [
    `Video vertical 9:16 para trend brasileira "${params.coverTitle}".`,
    `Estilo: ${params.style}.`,
    `Angulo criativo: ${params.angle}.`,
    `Shot: ${params.shot.label}.`,
    params.shot.styleRole ? `Papel de estilo: ${params.shot.styleRole}.` : '',
    params.shot.visualStyle ? `Estilo principal do shot: ${params.shot.visualStyle}.` : '',
    params.shot.styleDirection ? `Direcao de estilo: ${params.shot.styleDirection}.` : '',
    params.shot.visualIntent ? `Intencao visual: ${params.shot.visualIntent}.` : '',
    params.shot.subjectAction ? `Acao central do shot: ${params.shot.subjectAction}.` : '',
    params.shot.environmentAction ? `Reacao do ambiente: ${params.shot.environmentAction}.` : '',
    params.shot.cameraMove ? `Movimento de camera: ${params.shot.cameraMove}.` : '',
    params.shot.lens ? `Lente: ${params.shot.lens}.` : '',
    params.shot.framing ? `Enquadramento: ${params.shot.framing}.` : '',
    params.shot.lightShift ? `Mudanca de luz: ${params.shot.lightShift}.` : '',
    params.shot.transition ? `Transicao do beat: ${params.shot.transition}.` : '',
    params.shot.payoff ? `Payoff final do shot: ${params.shot.payoff}.` : '',
    params.shot.rhythm ? `Ritmo: ${params.shot.rhythm}.` : '',
    'Precisa parecer trecho de filme real, nao animacao de foto.',
    'Camera com deslocamento real, mudanca de composicao e payoff visual forte.',
  ].filter(Boolean).join(' ')

  return enhanceMotionPrompt(`${base} ${params.shot.motionPrompt.trim()}`, params.shot.label)
}

async function persistJobState(params: {
  jobId: string
  shots: TrendShotResult[]
  generationMemory?: JsonObject
  hasGenerationMemory?: boolean
  baseImageUrl?: string | null
  coverUrl?: string | null
  status: string
  providerModel: string
  providerJobId?: string | null
  videoUrl?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}) {
  const supabase = getAdminClient()
  await supabase
    .from('trend_video_jobs')
    .update(withOptionalTrendVideoGenerationMemory({
      shot_results: params.shots,
      base_image_url: params.baseImageUrl ?? null,
      cover_url: params.coverUrl ?? null,
      status: params.status,
      provider_model: params.providerModel,
      provider_job_id: params.providerJobId ?? null,
      video_url: params.videoUrl ?? null,
      error_code: params.errorCode ?? null,
      error_message: params.errorMessage ?? null,
    }, Boolean(params.hasGenerationMemory), params.generationMemory ?? {}) as unknown as TablesUpdate<'trend_video_jobs'>)
    .eq('id', params.jobId)
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [enabledRaw, durationSec, textProviderModel, textModelFallbacksRaw, imageProviderChainRaw, maxConcurrentRequestsRaw] = await Promise.all([
    getVariable(WORKSPACE_ID, 'trend_video_enabled'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_default_duration_sec'),
    getVariable(WORKSPACE_ID, 'trend_video_higgsfield_text_model_default'),
    getVariable(WORKSPACE_ID, 'trend_video_higgsfield_text_model_fallbacks'),
    getVariable(WORKSPACE_ID, 'trend_video_image_provider_chain'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_higgsfield_max_concurrent_requests'),
  ])

  const effectiveTextProviderModel = textProviderModel || 'seedance-2.0'
  const imageProviderChain = imageProviderChainRaw || 'openai,gemini'
  const effectiveDurationSec = clampShotDuration(durationSec || 6)
  const maxConcurrentRequests = Math.max(1, maxConcurrentRequestsRaw || DEFAULT_HIGGSFIELD_MAX_CONCURRENT_REQUESTS)
  const batchSize = Math.max(1, maxConcurrentRequests)

  if (!isEnabled(enabledRaw)) {
    return NextResponse.json({ ok: true, skipped: 'trend_video_disabled' })
  }

  const supabase = getAdminClient()
  const hasGenerationMemory = await supportsTrendVideoGenerationMemory(supabase)
  const jobSelect: string = hasGenerationMemory
    ? 'id, cover_title, angle, style, image_prompt, motion_prompt, base_image_url, cover_url, status, shot_results, generation_memory, provider_model, video_provider'
    : 'id, cover_title, angle, style, image_prompt, motion_prompt, base_image_url, cover_url, status, shot_results, provider_model, video_provider'
  const { data: jobsData } = await supabase
    .from('trend_video_jobs')
    .select(jobSelect)
    .eq('workspace_id', WORKSPACE_ID)
    .in('status', ['creative_ready', 'image_ready', 'cover_ready', 'rendering'])
    .order('created_at', { ascending: true })
    .limit(batchSize)
  const jobs = (jobsData ?? []) as unknown as Array<Record<string, unknown>>
  const { data: activeJobsData } = await supabase
    .from('trend_video_jobs')
    .select('shot_results, motion_prompt')
    .eq('workspace_id', WORKSPACE_ID)
    .in('status', ['creative_ready', 'image_ready', 'cover_ready', 'rendering'])
  let workspaceActiveRenderingShots = countActiveRenderingShotsInJobs(
    (activeJobsData ?? []) as unknown as Array<Record<string, unknown>>
  )

  if (!jobs?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_jobs_to_animate' })
  }

  const results: Array<{ id: string; status: string; videoUrl?: string; error?: string; shotsReady?: number; shotsTotal?: number }> = []

  for (const job of jobs) {
    const jobId = job.id as string
    let coverUrl = (job.cover_url as string | null) ?? ''
    let baseImageUrl = (job.base_image_url as string | null) ?? ''
    const generationMemory = parseGenerationMemory(hasGenerationMemory ? job.generation_memory : null)
    const providerModel = typeof job.provider_model === 'string' && job.provider_model.trim()
      ? job.provider_model
      : effectiveTextProviderModel
    const textModelChain = buildModelChain(providerModel, textModelFallbacksRaw || '', ['seedance-2.0'])
    let providerModelUsed = providerModel
    const shots = parseShotResults(
      { shot_results: job.shot_results, motion_prompt: job.motion_prompt },
      effectiveDurationSec,
    )

    // A capa/thumbnail usa o imagePrompt dedicado da geracao editorial (job.image_prompt) —
    // nunca deriva de nenhum shot de video.
    if (!baseImageUrl) {
      const generatedBaseImage = await generateTrendImageAsset({
        itemId: `${jobId}/cover-base`,
        prompt: (job.image_prompt as string | null) || (job.cover_title as string) || '',
        providerChain: imageProviderChain,
      })

      if (!generatedBaseImage) {
        await persistJobState({
          jobId,
          shots,
          generationMemory,
          hasGenerationMemory,
          baseImageUrl,
          coverUrl,
          status: 'failed',
          providerModel: providerModelUsed,
          errorCode: 'image_generation_failed',
          errorMessage: 'cover base image generation failed',
        })
        results.push({ id: jobId, status: 'failed', error: 'image_generation_failed' })
        continue
      }

      baseImageUrl = generatedBaseImage.url
      generationMemory.coverBaseImage = {
        provider: generatedBaseImage.provider,
        model: generatedBaseImage.model,
        promptOriginal: generatedBaseImage.promptOriginal,
        promptFinal: generatedBaseImage.promptFinal,
        negativePrompt: generatedBaseImage.negativePrompt,
        seed: generatedBaseImage.seed,
        params: generatedBaseImage.params,
        bucket: generatedBaseImage.bucket,
        storagePath: generatedBaseImage.storagePath,
        contentType: generatedBaseImage.contentType,
        attempts: generatedBaseImage.attempts,
        generatedAt: new Date().toISOString(),
        url: generatedBaseImage.url,
      }
    }

    if (!coverUrl && baseImageUrl) {
      const coverGeneratedAt = new Date().toISOString()
      const generatedCover = await generateTrendCover({
        itemId: jobId,
        title: job.cover_title as string,
        subtitle: job.angle as string,
        style: job.style as string,
        backgroundUrl: baseImageUrl,
      })

      if (!generatedCover) {
        await persistJobState({
          jobId,
          shots,
          generationMemory,
          hasGenerationMemory,
          baseImageUrl,
          coverUrl,
          status: 'failed',
          providerModel: providerModelUsed,
          errorCode: 'cover_generation_failed',
          errorMessage: 'trend cover generation failed',
        })
        results.push({ id: jobId, status: 'failed', error: 'cover_generation_failed' })
        continue
      }

      coverUrl = generatedCover
      generationMemory.coverRender = {
        provider: 'renderer',
        model: 'trend-cover',
        promptOriginal: job.image_prompt as string | null,
        promptFinal: job.image_prompt as string | null,
        negativePrompt: null,
        seed: null,
        params: {
          title: job.cover_title as string,
          subtitle: job.angle as string,
          style: job.style as string,
          backgroundUrl: baseImageUrl,
        },
        generatedAt: coverGeneratedAt,
        url: generatedCover,
      }
    }

    if (!isHiggsfieldConfigured() || !isHiggsfieldTextToVideoConfigured()) {
      await persistJobState({
        jobId,
        shots,
        generationMemory,
        hasGenerationMemory,
        baseImageUrl,
        coverUrl,
        status: 'cover_ready',
        providerModel: providerModelUsed,
        errorCode: 'higgsfield_text_to_video_unavailable',
        errorMessage: 'higgsfield text-to-video endpoint not configured',
      })
      results.push({ id: jobId, status: 'cover_ready', error: 'higgsfield_text_to_video_unavailable' })
      continue
    }

    let creditBlocked = false
    let concurrencyBlocked = false
    let concurrencyError: string | null = null
    let failedShotError: string | null = null

    for (const shot of shots) {
      if (isShotReady(shot)) {
        shot.status = 'ready'
        shot.error = null
        continue
      }

      if (shot.providerJobId) {
        const polled = await pollHiggsfieldJob(shot.providerJobId)

        if (polled.status === 'ready' && polled.videoUrl) {
          if (workspaceActiveRenderingShots > 0) workspaceActiveRenderingShots -= 1
          shot.clipUrl = polled.videoUrl
          shot.status = 'ready'
          shot.error = null
          updateLastVideoAttempt(shot, {
            status: polled.status,
            rawResponse: polled.rawResponse ?? null,
            completedAt: new Date().toISOString(),
            videoUrl: polled.videoUrl,
          })
          continue
        }

        if (polled.status === 'failed') {
          if (workspaceActiveRenderingShots > 0) workspaceActiveRenderingShots -= 1
          updateLastVideoAttempt(shot, {
            status: polled.status,
            rawResponse: polled.rawResponse ?? null,
            error: polled.error ?? 'higgsfield_poll_failed',
          })
          if (canRetryShot(shot)) {
            shot.retryCount += 1
            shot.providerJobId = null
            shot.status = 'pending'
            shot.error = polled.error ?? 'higgsfield_poll_failed_retrying'
          } else {
            shot.status = 'failed'
            shot.error = polled.error ?? 'higgsfield_poll_failed'
            failedShotError = shot.error
            break
          }
        } else {
          shot.status = 'rendering'
          updateLastVideoAttempt(shot, {
            status: polled.status,
            rawResponse: polled.rawResponse ?? null,
          })
          continue
        }
      }

      if (workspaceActiveRenderingShots >= maxConcurrentRequests) {
        concurrencyBlocked = true
        concurrencyError = `higgsfield_concurrency_limited:max_${maxConcurrentRequests}_active_requests_reached`
        break
      }

      const promptVideoPrompt = buildPromptVideoPrompt({
        coverTitle: job.cover_title as string,
        style: job.style as string,
        angle: job.angle as string,
        shot,
      })

      let started: HiggsfieldJobResult | undefined
      let startError: string | null = null

      for (const textModel of textModelChain) {
        // Validação empírica de duração: começa na duração pretendida e, se a API rejeitar
        // por duração fora do range, tenta durações menores (SHOT_DURATION_MIN=4). Evita
        // quebrar produção com um número de duração que a API não aceita.
        const durationCandidates = [...new Set([
          shot.durationSec,
          Math.max(SHOT_DURATION_MIN, Math.round(shot.durationSec * 0.7)),
          SHOT_DURATION_MIN,
        ])].filter((d) => d >= SHOT_DURATION_MIN)

        let candidate: HiggsfieldJobResult | undefined
        for (const durationTry of durationCandidates) {
          candidate = await startHiggsfieldTextToVideoJob({
            prompt: promptVideoPrompt,
            model: textModel,
            durationSec: durationTry,
            aspectRatio: '9:16',
          })
          providerModelUsed = textModel
          appendVideoAttempt(shot, {
            provider: candidate.provider ?? 'higgsfield',
            mode: candidate.mode ?? 'text_to_video',
            model: candidate.model ?? textModel,
            promptOriginal: promptVideoPrompt,
            promptFinal: promptVideoPrompt,
            durationSec: durationTry,
            negativePrompt: candidate.negativePrompt ?? null,
            seed: candidate.seed ?? null,
            params: candidate.requestParams ?? null,
            jobId: candidate.jobId ?? null,
            startedAt: new Date().toISOString(),
            status: candidate.status,
            rawResponse: candidate.rawResponse ?? null,
            error: candidate.error ?? null,
          })
          // Se a duração foi aceita (ou falhou por outro motivo), para de tentar durações.
          if (!isHiggsfieldDurationError(candidate.error)) {
            if (candidate.ok || candidate.status === 'queued' || candidate.status === 'processing' || candidate.status === 'ready') {
              shot.durationSec = durationTry
            }
            break
          }
        }
        if (!candidate) {
          startError = 'higgsfield_no_duration_candidate'
          continue
        }

        if (candidate.error === 'higgsfield_not_enough_credits') {
          creditBlocked = true
          startError = candidate.error
          break
        }

        if (isHiggsfieldConcurrencyLimitError(candidate.error)) {
          concurrencyBlocked = true
          startError = candidate.error ?? 'higgsfield_concurrency_limited'
          concurrencyError = startError
          break
        }

        if (candidate.ok || candidate.status === 'queued' || candidate.status === 'processing' || candidate.status === 'ready') {
          started = candidate
          break
        }

        startError = candidate.error ?? 'higgsfield_prompt_video_failed'
      }

      if (creditBlocked || concurrencyBlocked) break

      if (!started) {
        if (canRetryShot(shot)) {
          shot.retryCount += 1
          shot.status = 'pending'
          shot.error = startError ?? 'higgsfield_model_chain_failed_retrying'
          continue
        }
        shot.status = 'failed'
        shot.error = startError ?? 'higgsfield_all_models_failed'
        failedShotError = shot.error
        break
      }

      if (started.status === 'ready' && started.videoUrl) {
        shot.clipUrl = started.videoUrl
        shot.status = 'ready'
        shot.error = null
        shot.providerJobId = started.jobId ?? null
        updateLastVideoAttempt(shot, {
          status: started.status,
          rawResponse: started.rawResponse ?? null,
          completedAt: new Date().toISOString(),
          videoUrl: started.videoUrl,
        })
        continue
      }

      shot.providerJobId = started.jobId ?? null
      shot.status = 'rendering'
      shot.error = null
      if (started.jobId) workspaceActiveRenderingShots += 1
      updateLastVideoAttempt(shot, {
        status: started.status,
        rawResponse: started.rawResponse ?? null,
      })
    }

    if (failedShotError) {
      await persistJobState({
        jobId,
        shots,
        generationMemory,
        hasGenerationMemory,
        baseImageUrl,
        coverUrl,
        status: 'failed',
        providerModel: providerModelUsed,
        providerJobId: getRenderingShotJobId(shots),
        errorCode: 'trend_shot_failed',
        errorMessage: failedShotError,
      })
      results.push({ id: jobId, status: 'failed', error: failedShotError })
      continue
    }

    if (creditBlocked) {
      await persistJobState({
        jobId,
        shots,
        generationMemory,
        hasGenerationMemory,
        baseImageUrl,
        coverUrl,
        status: 'cover_ready',
        providerModel: providerModelUsed,
        errorCode: 'higgsfield_not_enough_credits',
        errorMessage: 'Not enough Higgsfield credits',
      })
      results.push({ id: jobId, status: 'cover_ready', error: 'higgsfield_not_enough_credits' })
      continue
    }

    if (concurrencyBlocked) {
      const summary = summarizeShots(shots)
      const nextStatus = countActiveRenderingShots(shots) > 0 ? 'rendering' : 'cover_ready'
      await persistJobState({
        jobId,
        shots,
        generationMemory,
        hasGenerationMemory,
        baseImageUrl,
        coverUrl,
        status: nextStatus,
        providerModel: providerModelUsed,
        providerJobId: getRenderingShotJobId(shots),
        errorCode: 'higgsfield_concurrency_limited',
        errorMessage: concurrencyError ?? `Maximum number of concurrent Higgsfield requests (${maxConcurrentRequests}) reached`,
      })
      results.push({
        id: jobId,
        status: nextStatus,
        error: concurrencyError ?? 'higgsfield_concurrency_limited',
        shotsReady: summary.ready,
        shotsTotal: summary.total,
      })
      continue
    }

    const allReady = shots.every(isShotReady)

    if (!allReady) {
      const summary = summarizeShots(shots)
      await persistJobState({
        jobId,
        shots,
        generationMemory,
        hasGenerationMemory,
        baseImageUrl,
        coverUrl,
        status: 'rendering',
        providerModel: providerModelUsed,
        providerJobId: getRenderingShotJobId(shots),
      })
      results.push({ id: jobId, status: 'rendering', shotsReady: summary.ready, shotsTotal: summary.total })
      continue
    }

    const finalVideoUrl = await stitchTrendVideoClips({
      jobId,
      clipUrls: shots.map((shot) => shot.clipUrl).filter((url): url is string => Boolean(url)),
      durationsSec: shots.map((shot) => shot.durationSec),
    })

    if (!finalVideoUrl) {
      await persistJobState({
        jobId,
        shots,
        generationMemory,
        hasGenerationMemory,
        baseImageUrl,
        coverUrl,
        status: 'failed',
        providerModel: providerModelUsed,
        errorCode: 'trend_video_stitch_failed',
        errorMessage: 'failed to stitch trend video clips',
      })
      results.push({ id: jobId, status: 'failed', error: 'trend_video_stitch_failed' })
      continue
    }

    generationMemory.finalVideo = {
      provider: 'ffmpeg',
      model: 'stitch-trend-video-clips',
      params: {
        clipUrls: shots.map((shot) => shot.clipUrl).filter((url): url is string => Boolean(url)),
        durationsSec: shots.map((shot) => shot.durationSec),
      },
      generatedAt: new Date().toISOString(),
      url: finalVideoUrl,
    }

    await persistJobState({
      jobId,
      shots,
      generationMemory,
      hasGenerationMemory,
      baseImageUrl,
      coverUrl,
      status: 'ready',
      providerModel: providerModelUsed,
      videoUrl: finalVideoUrl,
      providerJobId: null,
    })
    results.push({ id: jobId, status: 'ready', videoUrl: finalVideoUrl, shotsReady: shots.length, shotsTotal: shots.length })
  }

  return NextResponse.json({ ok: true, jobs: results })
}
