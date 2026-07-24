const OPENROUTER_IMAGE_MODEL = 'google/gemini-2.5-flash-image'

/**
 * Generate an image via OpenRouter's dedicated Image API. Never throws —
 * returns null on any failure (missing key, non-2xx, empty response) so
 * callers can treat this purely as an optional tier-0 attempt in front of
 * their existing (untouched) fallback cascade.
 */
export async function callOpenRouterImage(prompt: string, timeoutMs = 90_000): Promise<Buffer | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch('https://openrouter.ai/api/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OPENROUTER_IMAGE_MODEL, prompt }),
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (!res.ok) {
      console.warn(`[openrouter] image generation failed: ${res.status}`, await res.text().catch(() => ''))
      return null
    }

    const data = await res.json() as { data?: Array<{ b64_json?: string }> }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) return null
    return Buffer.from(b64, 'base64')
  } catch (err) {
    console.warn('[openrouter] image generation exception:', err instanceof Error ? err.message : err)
    return null
  }
}
