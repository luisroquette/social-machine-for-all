/**
 * Generate a Brand branded feed image.
 *
 * Pipeline:
 * 1. Gemini image generation → photorealistic dark background (EV/industrial scene)
 *    Fallback: gpt-image-1 medium ($0.042/img) if Gemini fails
 * 2. /api/og/brand-post (Satori) → editorial overlay (headline + KPI + branding)
 * 3. Result uploaded to Supabase storage → public URL returned
 */

import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { detectBrand, resolveLogoUrl } from './brand-logos'
import { callOpenRouterImage } from './openrouter'

const BUCKET = 'brand-mob'
const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image'

async function generateBackground(prompt: string): Promise<Buffer | null> {
  // 0. OpenRouter — single attempt, no retry. The Gemini→gpt-image-1 cascade
  // below is untouched and remains the fallback. Opt-in via OPENROUTER_API_KEY.
  const openRouterBuf = await callOpenRouterImage(prompt)
  if (openRouterBuf) {
    console.log('[brand-image] ✓ OpenRouter (gemini-2.5-flash-image)')
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
            contents: [{ parts: [{ text: `${prompt}\n\nVertical 3:4 portrait image. No text, no logos.` }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '3:4' } },
          }),
          signal: AbortSignal.timeout(90_000),
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
      console.warn('[brand-image] Gemini failed (status', res.status, ') — trying gpt-image-1 fallback...')
    } catch (err) {
      console.warn('[brand-image] Gemini exception:', err instanceof Error ? err.message : err, '— trying gpt-image-1...')
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
        size: '1024x1536',  // vertical mais próximo de 3:4 no gpt-image-1; o Satori cobre/recorta para 1080x1440
        quality: 'medium',
        output_format: 'png',
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) {
      console.error('[brand-image] gpt-image-1 error:', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = await res.json() as { data?: Array<{ b64_json?: string }> }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) return null
    return Buffer.from(b64, 'base64')
  } catch (err) {
    console.error('[brand-image] gpt-image-1 exception:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function generatebrandPostImage(params: {
  headline: string
  context: string
  kpi?: string
  imagePrompt: string
  itemId: string
}): Promise<string | null> {
  const supabase = getAdminClient()
  const base = getBaseUrl()

  // ── Step 1: Generate photorealistic background (Gemini → gpt-image-1 fallback) ──────
  const bgBuffer = await generateBackground(params.imagePrompt)
  if (!bgBuffer) {
    console.error('[brand-image] All image providers failed — aborting')
    return null
  }

  let bgUrl: string | null = null

  const bgPath = `backgrounds/${params.itemId}.png`
  const { error: bgErr } = await supabase.storage
    .from(BUCKET)
    .upload(bgPath, bgBuffer, { contentType: 'image/png', upsert: true })
  if (bgErr) {
    console.error('[brand-image] Background upload failed:', bgErr.message)
    return null
  }
  bgUrl = supabase.storage.from(BUCKET).getPublicUrl(bgPath).data.publicUrl

  // ── Step 2: Detect brand logo (fail-silent — badge is cosmetic) ────────
  const brandMatch = detectBrand([params.headline, params.context, params.kpi ?? '', params.imagePrompt])
  const brandLogo = brandMatch ? await resolveLogoUrl(brandMatch.domain) : null

  // ── Step 3: Render editorial overlay via Satori ─────────────────────────
  const qs = new URLSearchParams({
    headline: params.headline,
    context: params.context,
    ...(params.kpi        ? { kpi:   params.kpi }      : {}),
    ...(bgUrl             ? { bg:    bgUrl }            : {}),
    ...(brandLogo         ? { logo:  brandLogo.logoUrl, brand: brandLogo.name } : {}),
  })

  let finalUrl: string | null = bgUrl  // fallback: raw background if Satori fails

  try {
    const satoriRes = await fetch(`${base}/api/og/brand-post?${qs.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    })

    if (!satoriRes.ok) {
      console.error('[brand-image] Satori render failed:', satoriRes.status)
    } else {
      const finalPng = new Uint8Array(await satoriRes.arrayBuffer())
      const finalPath = `posts/${params.itemId}.png`
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(finalPath, finalPng, { contentType: 'image/png', upsert: true })
      if (upErr) {
        console.error('[brand-image] Final upload failed:', upErr.message)
      } else {
        finalUrl = supabase.storage.from(BUCKET).getPublicUrl(finalPath).data.publicUrl
      }
    }
  } catch (err) {
    console.error('[brand-image] Satori exception:', err instanceof Error ? err.message : err)
  }

  return finalUrl
}
