import { randomUUID } from 'crypto'
import { getAdminClient } from '@/lib/supabase/admin'
import { callOpenRouterImage } from './openrouter'

const DEFAULT_BUCKET = 'reels'
const DEFAULT_IMAGE_MODEL = 'gpt-image-1'
const OPENROUTER_IMAGE_MODEL_LABEL = 'google/gemini-2.5-flash-image'
type ImageProvider = 'openai' | 'gemini' | 'openrouter'

export interface ImageGenerationAttempt {
  provider: ImageProvider
  model: string
  status: 'success' | 'failed' | 'skipped'
  error: string | null
  startedAt: string
  completedAt: string
}

export interface StoredImageGenerationResult {
  url: string
  provider: ImageProvider
  model: string
  promptOriginal: string
  promptFinal: string
  negativePrompt: string | null
  seed: number | null
  size: '1024x1024' | '1024x1536' | '1536x1024'
  bucket: string
  storagePath: string
  contentType: 'image/png'
  params: Record<string, unknown>
  attempts: ImageGenerationAttempt[]
}

// ── OpenAI gpt-image-1 (fallback/premium) ───────────────────────────────────

async function generateImageBuffer(
  prompt: string,
  size: '1024x1024' | '1024x1536' | '1536x1024' = '1024x1536',
): Promise<Buffer | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL
  const body: Record<string, unknown> = { model, prompt, n: 1, size, quality: 'medium', output_format: 'png' }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    const isBilling = res.status === 429 || errBody.includes('Billing hard limit') || errBody.includes('quota') || errBody.includes('insufficient_quota')
    const isPolicy  = res.status === 400 && (errBody.includes('safety') || errBody.includes('content_policy') || errBody.includes('moderation'))
    const tag = isBilling ? '[BILLING]' : isPolicy ? '[CONTENT_POLICY]' : '[API_ERROR]'
    throw new Error(`OpenAI ${model} ${tag} (${res.status}): ${errBody.slice(0, 200)}`)
  }

  const data = await res.json() as { data?: Array<{ b64_json?: string }> }
  const b64 = data.data?.[0]?.b64_json
  if (!b64) return null
  return Buffer.from(b64, 'base64')
}

// ── Google Gemini image generation (default) ─────────────────────────────────

const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image'

async function generateImageBufferGemini(
  prompt: string,
  apiKey: string,
): Promise<Buffer | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prompt}\n\nPortrait 9:16 image. No text, no logos.` }] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '9:16' } },
      }),
      signal: AbortSignal.timeout(90_000),
    },
  )

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    const isBilling = res.status === 429 || errBody.includes('RESOURCE_EXHAUSTED') || errBody.includes('quota')
    const tag = isBilling ? '[BILLING]' : '[API_ERROR]'
    throw new Error(`Gemini imagen ${tag} (${res.status}): ${errBody.slice(0, 200)}`)
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }, inline_data?: { mime_type?: string; data?: string } }> }
    }>
  }
  const parts = data.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((part) =>
    part.inlineData?.mimeType?.startsWith('image/') || part.inline_data?.mime_type?.startsWith('image/')
  )
  const b64 = imagePart?.inlineData?.data ?? imagePart?.inline_data?.data
  if (!b64) return null
  return Buffer.from(b64, 'base64')
}

// ── Provider cascade: Gemini key 1 → Gemini key 2 → gpt-image-1 ─────────────

function normalizeImageProviderChain(value?: string[] | string): ImageProvider[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : ['gemini', 'openai']
  const seen = new Set<ImageProvider>()
  const chain: ImageProvider[] = []

  for (const item of raw) {
    const provider = item.trim().toLowerCase()
    if ((provider === 'openai' || provider === 'gemini') && !seen.has(provider)) {
      seen.add(provider)
      chain.push(provider)
    }
  }

  return chain.length ? chain : ['gemini', 'openai']
}

function buildAttempt(params: {
  provider: ImageProvider
  model: string
  status: ImageGenerationAttempt['status']
  startedAt: string
  error?: string | null
}): ImageGenerationAttempt {
  return {
    provider: params.provider,
    model: params.model,
    status: params.status,
    error: params.error ?? null,
    startedAt: params.startedAt,
    completedAt: new Date().toISOString(),
  }
}

async function generateWithFallback(
  prompt: string,
  size: '1024x1024' | '1024x1536' | '1536x1024',
  providerChain?: string[] | string,
): Promise<{ buffer: Buffer; provider: ImageProvider; model: string; attempts: ImageGenerationAttempt[] } | null> {
  const attempts: ImageGenerationAttempt[] = []

  // ── Tier 0: OpenRouter — single attempt, no retry. The Gemini/gpt-image-1
  // cascade below is untouched and remains the resilience layer (Cláusula
  // Pétrea: sempre gpt-image-1 nunca gpt-image-2). Opt-in via
  // OPENROUTER_API_KEY — callOpenRouterImage() never throws, returns null on
  // any failure so behavior below is unaffected when it's not configured.
  const openRouterStartedAt = new Date().toISOString()
  const openRouterBuf = await callOpenRouterImage(prompt)
  if (openRouterBuf) {
    console.log('[openai-image] ✓ OpenRouter (gemini-2.5-flash-image)')
    attempts.push(buildAttempt({ provider: 'openrouter', model: OPENROUTER_IMAGE_MODEL_LABEL, status: 'success', startedAt: openRouterStartedAt }))
    return { buffer: openRouterBuf, provider: 'openrouter', model: OPENROUTER_IMAGE_MODEL_LABEL, attempts }
  }
  if (process.env.OPENROUTER_API_KEY) {
    attempts.push(buildAttempt({ provider: 'openrouter', model: OPENROUTER_IMAGE_MODEL_LABEL, status: 'failed', startedAt: openRouterStartedAt, error: 'openrouter_failed_or_empty' }))
  }

  const chain = normalizeImageProviderChain(providerChain)

  for (const provider of chain) {
    if (provider === 'openai') {
      const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL
      const startedAt = new Date().toISOString()
      try {
        const buf = await generateImageBuffer(prompt, size)
        if (buf) {
          console.log('[openai-image] ✓ gpt-image-1')
          attempts.push(buildAttempt({ provider, model, status: 'success', startedAt }))
          return { buffer: buf, provider, model, attempts }
        }
        attempts.push(buildAttempt({ provider, model, status: 'failed', startedAt, error: 'empty_image_response' }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        attempts.push(buildAttempt({ provider, model, status: 'failed', startedAt, error: message }))
        console.warn('[openai-image] gpt-image-1 failed:', message)
      }
      continue
    }

    const geminiKeys = [
      process.env.GEMINI_API_KEY_1,
      process.env.GEMINI_API_KEY_2,
    ].filter(Boolean) as string[]

    if (!geminiKeys.length) {
      attempts.push(buildAttempt({
        provider,
        model: GEMINI_IMAGE_MODEL,
        status: 'skipped',
        startedAt: new Date().toISOString(),
        error: 'missing_gemini_api_key',
      }))
      continue
    }

    for (let i = 0; i < geminiKeys.length; i++) {
      const startedAt = new Date().toISOString()
      try {
        const buf = await generateImageBufferGemini(prompt, geminiKeys[i])
        if (buf) {
          console.log(`[openai-image] ✓ Gemini Imagen (key ${i + 1})`)
          attempts.push(buildAttempt({ provider, model: GEMINI_IMAGE_MODEL, status: 'success', startedAt }))
          return { buffer: buf, provider, model: GEMINI_IMAGE_MODEL, attempts }
        }
        attempts.push(buildAttempt({ provider, model: GEMINI_IMAGE_MODEL, status: 'failed', startedAt, error: `empty_image_response_key_${i + 1}` }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        attempts.push(buildAttempt({ provider, model: GEMINI_IMAGE_MODEL, status: 'failed', startedAt, error: message }))
        console.warn(`[openai-image] Gemini key ${i + 1} failed:`, message)
      }
    }
  }

  console.error('[openai-image] All providers failed — no background generated')
  return null
}


export async function generateStoredImageWithMetadata(params: {
  prompt: string
  path?: string
  bucket?: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  providerChain?: string[] | string
}): Promise<StoredImageGenerationResult | null> {
  const {
    prompt,
    path = `generated/${randomUUID()}.png`,
    bucket = DEFAULT_BUCKET,
    size = '1024x1536',
    providerChain,
  } = params

  const supabase = getAdminClient()

  const generated = await generateWithFallback(prompt, size, providerChain)
  if (!generated) return null

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, generated.buffer, { contentType: 'image/png', upsert: true })

  if (error) {
    console.error('[openai-image] storage upload failed:', error.message)
    return null
  }

  return {
    url: supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
    provider: generated.provider,
    model: generated.model,
    promptOriginal: prompt,
    promptFinal: prompt,
    negativePrompt: null,
    seed: null,
    size,
    bucket,
    storagePath: path,
    contentType: 'image/png',
    attempts: generated.attempts,
    params: {
      size,
      output_format: 'png',
      quality: generated.provider === 'openai' ? 'medium' : null,
    },
  }
}

export async function generateStoredImage(params: {
  prompt: string
  path?: string
  bucket?: string
  size?: '1024x1024' | '1024x1536' | '1536x1024'
  providerChain?: string[] | string
}): Promise<string | null> {
  const result = await generateStoredImageWithMetadata(params)
  return result?.url ?? null
}
