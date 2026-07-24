/**
 * Instagram Business Discovery API — read-only functions for content curation.
 *
 * Reads public Business/Creator accounts' media (Reels + Videos).
 * Uses the same IG credentials as publishing (igUserId + accessToken).
 * Does NOT require the target account to be connected — works for any public Business account.
 */

const IG_API_BASE = 'https://graph.facebook.com/v21.0'

export interface IGReelItem {
  mediaId: string
  mediaUrl: string        // CDN Meta — expires ~24h → archive immediately
  thumbnailUrl: string
  caption: string
  timestamp: string       // ISO
  permalink: string       // stable URL — used for dedup
  username: string
}

type IGMediaNode = {
  id?: string
  media_type?: string
  media_url?: string
  thumbnail_url?: string
  caption?: string
  timestamp?: string
  permalink?: string
}

type IGDiscoveryResponse = {
  business_discovery?: {
    media?: {
      data?: IGMediaNode[]
    }
  }
  error?: { message: string; code: number }
}

/**
 * Get recent Reels/Videos from a public Instagram Business/Creator account.
 * Uses Business Discovery API — target account must be Business or Creator type.
 * sinceTimestamp: ISO string — only return posts newer than this.
 */
export async function getInstagramAccountReels(
  igUserId: string,
  accessToken: string,
  targetUsername: string,
  sinceTimestamp?: string,
): Promise<IGReelItem[]> {
  // Build URL manually — URLSearchParams encodes { and } which breaks Meta's field parsing
  const fields = 'business_discovery.fields(media{id,media_type,media_url,thumbnail_url,caption,timestamp,permalink})'
  const url = `${IG_API_BASE}/${igUserId}?fields=${fields}&username=${encodeURIComponent(targetUsername)}&access_token=${encodeURIComponent(accessToken)}`

  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`IG Business Discovery ${targetUsername} HTTP ${res.status}: ${body.slice(0, 200)}`)
  }

  try {
    const data = await res.json() as IGDiscoveryResponse

    if (data.error) {
      throw new Error(`IG Business Discovery ${targetUsername} API error ${data.error.code}: ${data.error.message}`)
    }

    const nodes = data.business_discovery?.media?.data ?? []
    const cutoff = sinceTimestamp ? new Date(sinceTimestamp).getTime() : 0

    return nodes
      .filter(n => {
        if (!n.id || !n.media_url) return false
        if (n.media_type !== 'VIDEO' && n.media_type !== 'REELS') return false
        if ((n.caption ?? '').length < 20) return false
        if (cutoff && n.timestamp && new Date(n.timestamp).getTime() <= cutoff) return false
        return true
      })
      .map(n => ({
        mediaId: n.id!,
        mediaUrl: n.media_url!,
        thumbnailUrl: n.thumbnail_url ?? '',
        caption: n.caption ?? '',
        timestamp: n.timestamp ?? new Date().toISOString(),
        permalink: n.permalink ?? '',
        username: targetUsername,
      }))
  } catch (err) {
    throw new Error(`IG Business Discovery ${targetUsername}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
