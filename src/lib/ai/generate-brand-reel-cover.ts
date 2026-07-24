/**
 * Generate a Brand branded Reel cover image (9:16).
 *
 * Pipeline:
 * 1. Gemini image generation → photorealistic 9:16 background (EV/industrial scene)
 *    Fallback: gpt-image-1 medium ($0.042/img) if Gemini fails
 * 2. /api/og/brand-reel-cover (Satori) → editorial overlay (hookTitle + highlight + branding)
 * 3. Result uploaded to Supabase storage → public URL returned
 */

import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { callOpenRouterImage } from './openrouter'

const BUCKET = 'brand-assets'
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image'

async function generateBackground(prompt: string): Promise<Buffer | null> {
  // 0. OpenRouter — single attempt, no retry. Timeout kept short (20s, vs the
  // 90s default elsewhere) because this whole function shares a combined
  // budget with the parallel reel video render — see the Gemini call below
  // for the full rationale (45s cap, reduced from 90s after a prior incident).
  const openRouterBuf = await callOpenRouterImage(prompt, 20_000)
  if (openRouterBuf) {
    console.log('[brand-reel-cover] ✓ OpenRouter (gemini-2.5-flash-image)')
    return openRouterBuf
  }

  // 1. Gemini image generation primary
  const geminiKey = (process.env.GEMINI_API_KEY_2 ?? process.env.GEMINI_API_KEY ?? '').trim()
  if (geminiKey) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${geminiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${prompt}\n\nPortrait 9:16 image. No text, no logos.` }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '9:16' } },
          }),
          // 45s (was 90s) — this runs in parallel with the reel video render (capped at 120s),
          // and Gemini→gpt-image-1 fallback is sequential, so worst case must stay well under
          // the render cap to avoid becoming the bottleneck of the combined publish pipeline
          // (see renderWithRemotion in publisher/index.ts for the full budget rationale).
          signal: AbortSignal.timeout(45_000),
        },
      )
      if (res.ok) {
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
        if (b64) return Buffer.from(b64, 'base64')
      }
      console.warn('[brand-reel-cover] Gemini failed (status', res.status, ') — trying gpt-image-1 fallback...')
    } catch (err) {
      console.warn('[brand-reel-cover] Gemini exception:', err instanceof Error ? err.message : err, '— trying gpt-image-1...')
    }
  }

  // 2. gpt-image-1 medium fallback ($0.042/img)
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return null
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        n: 1,
        size: '1024x1536',
        quality: 'medium',
        output_format: 'png',
      }),
      // 45s (was 90s) — see Gemini call above for the shared budget rationale.
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) {
      console.error('[brand-reel-cover] gpt-image-1 error:', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = await res.json() as { data?: Array<{ b64_json?: string }> }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) return null
    return Buffer.from(b64, 'base64')
  } catch (err) {
    console.error('[brand-reel-cover] gpt-image-1 exception:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function generatebrandReelCover(params: {
  hookTitle: string
  highlightName: string
  imagePrompt: string
  itemId: string
  kpi?: string
}): Promise<string | null> {
  const supabase = getAdminClient()
  const base = getBaseUrl()

  // ── Step 1: Generate photorealistic 9:16 background (Gemini → gpt-image-1 fallback) ───
  const bgBuffer = await generateBackground(params.imagePrompt)
  if (!bgBuffer) {
    console.warn('[brand-reel-cover] All providers failed — Satori-only cover (no bg photo)')
  }

  let bgUrl = ''
  if (bgBuffer) {
    const bgPath = `reel-covers/bg-${params.itemId}.png`
    const { error: bgErr } = await supabase.storage
      .from(BUCKET)
      .upload(bgPath, bgBuffer, { contentType: 'image/png', upsert: true })
    if (bgErr) {
      console.warn('[brand-reel-cover] Background upload failed:', bgErr.message, '— continuing without bg')
    } else {
      bgUrl = supabase.storage.from(BUCKET).getPublicUrl(bgPath).data.publicUrl
    }
  }

  // ── Step 2: Render editorial overlay via Satori (works with or without bg) ─────────
  const qs = new URLSearchParams({
    hookTitle:     params.hookTitle,
    highlightName: params.highlightName,
    ...(bgUrl ? { bg: bgUrl } : {}),
    ...(params.kpi ? { kpi: params.kpi } : {}),
  })

  try {
    const satoriRes = await fetch(`${base}/api/og/brand-reel-cover?${qs.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    })

    if (!satoriRes.ok) {
      console.error('[brand-reel-cover] Satori render failed:', satoriRes.status)
      return bgUrl  // fallback: raw background
    }

    const finalPng = new Uint8Array(await satoriRes.arrayBuffer())
    const finalPath = `reel-covers/${params.itemId}.png`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(finalPath, finalPng, { contentType: 'image/png', upsert: true })
    if (upErr) {
      console.error('[brand-reel-cover] Final upload failed:', upErr.message)
      return bgUrl  // fallback: raw background
    }

    return supabase.storage.from(BUCKET).getPublicUrl(finalPath).data.publicUrl
  } catch (err) {
    console.error('[brand-reel-cover] Satori exception:', err instanceof Error ? err.message : err)
    return bgUrl  // fallback: raw background
  }
}
