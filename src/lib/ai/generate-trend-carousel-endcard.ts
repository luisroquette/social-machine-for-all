import { getAdminClient } from '@/lib/supabase/admin'

export async function generateTrendCarouselEndcard(params: {
  jobId: string
  handle: string
  keyword: string
  title?: string
  subtitle?: string
}): Promise<string | null> {
  const supabase = getAdminClient()
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.APP_BASE_URL ?? null

  if (!base) {
    console.error('[trend-carousel-endcard] missing base url')
    return null
  }

  const qs = new URLSearchParams({
    handle: params.handle,
    keyword: params.keyword,
    title: params.title ?? 'QUER O PROMPT?',
    subtitle: params.subtitle ?? 'Segue o perfil para aprender tudo sobre IA e videos virais.',
  })

  try {
    const res = await fetch(`${base}/api/og/trend-carousel-endcard?${qs.toString()}`, {
      signal: AbortSignal.timeout(20_000),
      headers: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : undefined,
    })

    if (!res.ok) {
      console.error('[trend-carousel-endcard] OG render failed:', res.status)
      return null
    }

    const png = new Uint8Array(await res.arrayBuffer())
    const path = `trend-videos/endcards/${params.jobId}.png`
    const { error } = await supabase.storage.from('reels').upload(path, png, {
      contentType: 'image/png',
      upsert: true,
    })

    if (error) {
      console.error('[trend-carousel-endcard] upload failed:', error.message)
      return null
    }

    return supabase.storage.from('reels').getPublicUrl(path).data.publicUrl
  } catch (error) {
    console.error('[trend-carousel-endcard] render failed:', error instanceof Error ? error.message : error)
    return null
  }
}
