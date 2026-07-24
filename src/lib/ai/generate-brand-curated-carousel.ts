import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { detectBrand, resolveLogoUrl } from './brand-logos'

const BUCKET = 'brand-mob'

export type CuratedCarouselSlide = {
  type: 'cover' | 'content' | 'cta'
  headline: string
  body?: string
  context?: string
  kpi?: string
}

export async function generatebrandCuratedCarousel(params: {
  slides: CuratedCarouselSlide[]
  sourceImageUrls: string[]
  eyebrow: string
  itemId: string
}): Promise<string[] | null> {
  if (params.slides.length < 2 || params.sourceImageUrls.length < 2) return null

  const supabase = getAdminClient()
  const base = getBaseUrl()
  const total = Math.min(params.slides.length, params.sourceImageUrls.length)

  const brandMatch = detectBrand([
    params.eyebrow,
    ...params.slides.flatMap((slide) => [slide.headline, slide.body ?? '', slide.context ?? '', slide.kpi ?? '']),
  ])
  const brandLogo = brandMatch ? await resolveLogoUrl(brandMatch.domain) : null

  const outputs = await Promise.all(
    params.slides.slice(0, total).map(async (slide, index) => {
      const qs = new URLSearchParams({
        type: slide.type,
        headline: slide.headline,
        eyebrow: params.eyebrow,
        bg: params.sourceImageUrls[index],
        slide_num: String(index + 1),
        total_slides: String(total),
        ...(slide.body ? { body: slide.body } : {}),
        ...(slide.context ? { context: slide.context } : {}),
        ...(slide.kpi ? { kpi: slide.kpi } : {}),
        ...(brandLogo && slide.type !== 'cta' ? { logo: brandLogo.logoUrl, brand: brandLogo.name } : {}),
      })

      try {
        const satoriRes = await fetch(`${base}/api/og/brand-slide?${qs.toString()}`, {
          signal: AbortSignal.timeout(20_000),
        })

        if (!satoriRes.ok) {
          console.error(`[brand-curated-carousel] Satori slide ${index + 1} failed:`, satoriRes.status)
          return null
        }

        const png = new Uint8Array(await satoriRes.arrayBuffer())
        const slidePath = `carousel/curated-${params.itemId}-${index}.png`
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(slidePath, png, { contentType: 'image/png', upsert: true })

        if (error) {
          console.error(`[brand-curated-carousel] Upload slide ${index + 1} failed:`, error.message)
          return null
        }

        return supabase.storage.from(BUCKET).getPublicUrl(slidePath).data.publicUrl
      } catch (err) {
        console.error(`[brand-curated-carousel] Slide ${index + 1} exception:`, err instanceof Error ? err.message : err)
        return null
      }
    }),
  )

  const validUrls = outputs.filter((url): url is string => url !== null)
  return validUrls.length >= 2 ? validUrls : null
}
