import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { detectBrand, resolveLogoUrl } from './brand-logos'

const BUCKET = 'brand-mob'

export async function generatebrandCuratedPostImage(params: {
  headline: string
  context: string
  kpi?: string
  eyebrow: string
  sourceImageUrl: string
  itemId: string
}): Promise<string | null> {
  const supabase = getAdminClient()
  const base = getBaseUrl()

  const brandMatch = detectBrand([params.headline, params.context, params.kpi ?? '', params.sourceImageUrl])
  const brandLogo = brandMatch ? await resolveLogoUrl(brandMatch.domain) : null

  const qs = new URLSearchParams({
    headline: params.headline,
    context: params.context,
    eyebrow: params.eyebrow,
    bg: params.sourceImageUrl,
    ...(params.kpi ? { kpi: params.kpi } : {}),
    ...(brandLogo ? { logo: brandLogo.logoUrl, brand: brandLogo.name } : {}),
  })

  try {
    const satoriRes = await fetch(`${base}/api/og/brand-post?${qs.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    })

    if (!satoriRes.ok) {
      console.error('[brand-curated-post] Satori render failed:', satoriRes.status)
      return null
    }

    const png = new Uint8Array(await satoriRes.arrayBuffer())
    const finalPath = `posts/curated-${params.itemId}.png`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(finalPath, png, { contentType: 'image/png', upsert: true })

    if (error) {
      console.error('[brand-curated-post] Final upload failed:', error.message)
      return null
    }

    return supabase.storage.from(BUCKET).getPublicUrl(finalPath).data.publicUrl
  } catch (err) {
    console.error('[brand-curated-post] Exception:', err instanceof Error ? err.message : err)
    return null
  }
}
