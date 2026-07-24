export interface HiggsfieldTextToVideoStartInput {
  prompt: string
  model: string
  durationSec: number
  aspectRatio?: '9:16' | '1:1' | '16:9' | '4:5'
  referenceImages?: string[]
}

export interface HiggsfieldJobResult {
  ok: boolean
  configured: boolean
  status: 'queued' | 'processing' | 'ready' | 'failed'
  jobId?: string
  videoUrl?: string
  error?: string
  provider?: 'higgsfield'
  mode?: 'text_to_video'
  model?: string
  negativePrompt?: string | null
  seed?: number | null
  requestParams?: Record<string, unknown>
  rawResponse?: Record<string, unknown>
}

interface HiggsfieldConfig {
  base: string
  credentials: string
  textToVideoCreatePath: string
  statusPath: string
}

function getConfig(): HiggsfieldConfig {
  const base = (process.env.HIGGSFIELD_API_BASE ?? 'https://platform.higgsfield.ai').trim()
  const textToVideoCreatePath = (
    process.env.HIGGSFIELD_TEXT_TO_VIDEO_CREATE_PATH ??
    process.env.HIGGSFIELD_VIDEO_CREATE_PATH ??
    ''
  ).trim()
  const statusPath = (process.env.HIGGSFIELD_STATUS_PATH ?? '/requests/{id}/status').trim()

  const keyId = (process.env.HIGGSFIELD_API_KEY_ID ?? process.env.HF_API_KEY ?? '').trim()
  const secretKey = (
    process.env.HIGGSFIELD_API_SECRET_KEY ??
    process.env.HIGGSFIELD_SECRET ??
    process.env.HF_API_SECRET ??
    process.env.HF_SECRET ??
    ''
  ).trim()
  const combined = (
    process.env.HIGGSFIELD_CREDENTIALS ??
    process.env.HIGGSFIELD_API_KEY ??
    process.env.HF_CREDENTIALS ??
    process.env.HF_KEY ??
    ''
  ).trim()

  const credentials = combined.includes(':')
    ? combined
    : keyId && secretKey
      ? `${keyId}:${secretKey}`
      : ''

  return { base, credentials, textToVideoCreatePath, statusPath }
}

function buildUrl(base: string, path: string): string {
  if (!base) return ''
  return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function parseJobId(data: Record<string, unknown>): string | undefined {
  const jobId = data.request_id ?? data.id ?? data.jobId ?? data.generationId
  return typeof jobId === 'string' ? jobId : undefined
}

function parseStatus(data: Record<string, unknown>): 'queued' | 'processing' | 'ready' | 'failed' {
  const raw = String(data.status ?? data.state ?? '').toLowerCase()
  if (raw === 'nsfw') return 'failed'
  if (raw.includes('fail') || raw.includes('error')) return 'failed'
  if (raw.includes('ready') || raw.includes('done') || raw.includes('complete') || raw.includes('finished') || data.videoUrl || data.url) {
    return 'ready'
  }
  if (raw.includes('process') || raw.includes('render') || raw.includes('running') || raw.includes('progress')) {
    return 'processing'
  }
  return 'queued'
}

function parseVideoUrl(data: Record<string, unknown>): string | undefined {
  const direct = data.videoUrl ?? data.url
  if (typeof direct === 'string' && direct.startsWith('http')) return direct

  const output = data.output
  if (output && typeof output === 'object') {
    const nested = (output as Record<string, unknown>).videoUrl ?? (output as Record<string, unknown>).url
    if (typeof nested === 'string' && nested.startsWith('http')) return nested
  }

  const video = data.video
  if (video && typeof video === 'object') {
    const nested = (video as Record<string, unknown>).url
    if (typeof nested === 'string' && nested.startsWith('http')) return nested
  }

  return undefined
}

function buildHeaders(credentials: string): HeadersInit {
  return {
    Authorization: `Key ${credentials}`,
    'Content-Type': 'application/json',
    'User-Agent': 'higgsfield-server-js/2.0',
  }
}

export function isHiggsfieldConfigured(): boolean {
  const { base, credentials } = getConfig()
  return Boolean(base && credentials)
}

export function isHiggsfieldTextToVideoConfigured(): boolean {
  const { base, credentials, textToVideoCreatePath } = getConfig()
  return Boolean(base && credentials && textToVideoCreatePath)
}

export function isHiggsfieldConcurrencyLimitError(error: string | null | undefined): boolean {
  if (!error) return false
  const normalized = error.toLowerCase()
  return normalized.includes('maximum number of concurrent requests') ||
    normalized.includes('concurrent requests') ||
    normalized.includes('too many requests')
}

async function startHiggsfieldJob(params: {
  createPath: string
  payload: Record<string, unknown>
  model: string
  requestParams: Record<string, unknown>
}): Promise<HiggsfieldJobResult> {
  const { base, credentials } = getConfig()
  if (!base || !credentials) {
    return { ok: false, configured: false, status: 'failed', error: 'higgsfield_not_configured' }
  }

  const res = await fetch(buildUrl(base, params.createPath), {
    method: 'POST',
    headers: buildHeaders(credentials),
    body: JSON.stringify(params.payload),
    signal: AbortSignal.timeout(45_000),
  })

  if (!res.ok) {
    const error = await res.text().catch(() => '')
    const loweredError = error.toLowerCase()

    if (res.status === 403 && loweredError.includes('not enough credits')) {
      return {
        ok: false,
        configured: true,
        status: 'failed',
        error: 'higgsfield_not_enough_credits',
        provider: 'higgsfield',
        mode: 'text_to_video',
        model: params.model,
        negativePrompt: null,
        seed: null,
        requestParams: params.requestParams,
      }
    }

    if (res.status === 404 && loweredError.includes('model not found')) {
      return {
        ok: false,
        configured: true,
        status: 'failed',
        error: 'higgsfield_text_to_video_unavailable',
        provider: 'higgsfield',
        mode: 'text_to_video',
        model: params.model,
        negativePrompt: null,
        seed: null,
        requestParams: params.requestParams,
      }
    }

    return {
      ok: false,
      configured: true,
      status: 'failed',
      error: `higgsfield_start_failed:${res.status}:${error.slice(0, 160)}`,
      provider: 'higgsfield',
      mode: 'text_to_video',
      model: params.model,
      negativePrompt: null,
      seed: null,
      requestParams: params.requestParams,
    }
  }

  const data = await res.json() as Record<string, unknown>
  return {
    ok: true,
    configured: true,
    status: parseStatus(data),
    jobId: parseJobId(data),
    videoUrl: parseVideoUrl(data),
    provider: 'higgsfield',
    mode: 'text_to_video',
    model: params.model,
    negativePrompt: null,
    seed: null,
    requestParams: params.requestParams,
    rawResponse: data,
  }
}

export async function startHiggsfieldTextToVideoJob(input: HiggsfieldTextToVideoStartInput): Promise<HiggsfieldJobResult> {
  const { textToVideoCreatePath } = getConfig()
  const requestParams = {
    model: input.model.trim(),
    prompt: input.prompt,
    duration_sec: input.durationSec,
    aspect_ratio: input.aspectRatio ?? '9:16',
    input_images: (input.referenceImages ?? [])
      .filter((imageUrl) => imageUrl.startsWith('http'))
      .map((imageUrl) => ({ type: 'image_url', image_url: imageUrl })),
  }

  if (!textToVideoCreatePath) {
    return {
      ok: false,
      configured: isHiggsfieldConfigured(),
      status: 'failed',
      error: 'higgsfield_text_to_video_unavailable',
      provider: 'higgsfield',
      mode: 'text_to_video',
      model: input.model.trim(),
      negativePrompt: null,
      seed: null,
      requestParams,
    }
  }

  return startHiggsfieldJob({
    createPath: textToVideoCreatePath,
    payload: { params: requestParams },
    model: input.model.trim(),
    requestParams,
  })
}

export async function pollHiggsfieldJob(jobId: string): Promise<HiggsfieldJobResult> {
  const { base, credentials, statusPath } = getConfig()
  if (!base || !credentials) {
    return { ok: false, configured: false, status: 'failed', error: 'higgsfield_not_configured' }
  }

  const path = statusPath.replace('{id}', encodeURIComponent(jobId))
  const res = await fetch(buildUrl(base, path), {
    headers: buildHeaders(credentials),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const error = await res.text().catch(() => '')
    return { ok: false, configured: true, status: 'failed', error: `higgsfield_poll_failed:${res.status}:${error.slice(0, 160)}` }
  }

  const data = await res.json() as Record<string, unknown>
  return {
    ok: true,
    configured: true,
    status: parseStatus(data),
    jobId: parseJobId(data) ?? jobId,
    videoUrl: parseVideoUrl(data),
    provider: 'higgsfield',
    negativePrompt: null,
    seed: null,
    rawResponse: data,
  }
}
