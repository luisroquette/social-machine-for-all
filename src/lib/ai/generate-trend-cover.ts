import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'

export async function generateTrendCover(params: {
  itemId: string
  title: string
  subtitle?: string
  style?: string
  backgroundUrl: string
}): Promise<string | null> {
  const base = getBaseUrl()
  const supabase = getAdminClient()

  const qs = new URLSearchParams({
    title: params.title,
    ...(params.subtitle ? { subtitle: params.subtitle } : {}),
    ...(params.style ? { style: params.style } : {}),
    bg: params.backgroundUrl,
  })

  const res = await fetch(`${base}/api/og/trend-reel-cover?${qs.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    console.error('[trend-cover] OG render failed:', res.status)
    return params.backgroundUrl
  }

  const png = new Uint8Array(await res.arrayBuffer())
  const path = `trend-videos/covers/${params.itemId}.png`
  const { error } = await supabase.storage.from('reels').upload(path, png, {
    contentType: 'image/png',
    upsert: true,
  })

  if (error) {
    console.error('[trend-cover] upload failed:', error.message)
    return params.backgroundUrl
  }

  return supabase.storage.from('reels').getPublicUrl(path).data.publicUrl
}
