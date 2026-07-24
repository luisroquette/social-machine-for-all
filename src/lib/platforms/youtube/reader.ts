/**
 * YouTube Data API v3 — read-only functions for content curation.
 *
 * Separate from YouTubeClient (publish-only). Uses same OAuth2 env vars.
 * Quota budget: ~2,500 units/run out of 10,000 daily free quota.
 *   - search (keyword or channel): 100 units/call
 */

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

// ── Token cache (in-memory, per cold start) ────────────────────────────────
let cachedToken: string | null = null
let tokenExpiresAt = 0

// ── Auth helpers ──────────────────────────────────────────────────────────────
// Supports two auth modes:
//   1. API key  — set YOUTUBE_API_KEY (preferred, no expiry)
//   2. OAuth2   — set YOUTUBE_CLIENT_ID + YOUTUBE_CLIENT_SECRET + YOUTUBE_REFRESH_TOKEN

function getApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY ?? null
}

async function getOAuthToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken

  const clientId = process.env.YOUTUBE_CLIENT_ID
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) return null

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube token refresh failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json() as { access_token: string; expires_in: number }
  cachedToken = data.access_token
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
  return cachedToken
}


export interface YouTubeVideoItem {
  videoId: string
  title: string
  description: string      // first 500 chars
  publishedAt: string
  thumbnailUrl: string
  channelTitle: string
  channelId: string
  videoUrl: string         // https://youtube.com/watch?v={videoId}
}

type YTSearchItem = {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelTitle?: string
    channelId?: string
    thumbnails?: { maxres?: { url: string }; high?: { url: string }; medium?: { url: string } }
  }
}

function mapItem(item: YTSearchItem): YouTubeVideoItem | null {
  const videoId = item.id?.videoId
  const snippet = item.snippet
  if (!videoId || !snippet) return null
  return {
    videoId,
    title: snippet.title ?? '',
    description: (snippet.description ?? '').slice(0, 500),
    publishedAt: snippet.publishedAt ?? new Date().toISOString(),
    thumbnailUrl: snippet.thumbnails?.maxres?.url ?? snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? '',
    channelTitle: snippet.channelTitle ?? '',
    channelId: snippet.channelId ?? '',
    videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
  }
}

/**
 * Search YouTube for recent videos matching a query.
 * Costs 100 quota units per call.
 */
export async function searchYouTubeVideos(
  query: string,
  maxResults = 10,
  publishedAfter?: Date,
): Promise<YouTubeVideoItem[]> {
  const apiKey = getApiKey()
  let authHeader: Record<string, string> = {}
  let keyParam = ''

  if (apiKey) {
    keyParam = `&key=${encodeURIComponent(apiKey)}`
  } else {
    const token = await getOAuthToken()  // throws on failure
    if (!token) throw new Error('No YouTube auth: set YOUTUBE_API_KEY or YOUTUBE_REFRESH_TOKEN')
    authHeader = { Authorization: `Bearer ${token}` }
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'date',
    videoDuration: 'short',
    q: query,
    maxResults: String(maxResults),
    ...(publishedAfter ? { publishedAfter: publishedAfter.toISOString() } : {}),
  })

  const res = await fetch(`${YOUTUBE_API_BASE}/search?${params}${keyParam}`, {
    headers: authHeader,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube search failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json() as { items?: YTSearchItem[] }
  return (data.items ?? []).map(mapItem).filter((v): v is YouTubeVideoItem => v !== null)
}

/**
 * Resolve a YouTube @handle to a channel ID (UCxxx).
 * Costs 1 quota unit. Returns null if not found.
 * Pass handle with or without '@': 'electrek' or '@electrek'.
 */
export async function resolveChannelHandle(handle: string): Promise<string | null> {
  const apiKey = getApiKey()
  let authHeader: Record<string, string> = {}
  let keyParam = ''
  if (apiKey) {
    keyParam = `&key=${encodeURIComponent(apiKey)}`
  } else {
    const token = await getOAuthToken()
    if (!token) return null
    authHeader = { Authorization: `Bearer ${token}` }
  }
  const forHandle = handle.startsWith('@') ? handle : `@${handle}`
  const params = new URLSearchParams({ part: 'id', forHandle })
  const res = await fetch(`${YOUTUBE_API_BASE}/channels?${params}${keyParam}`, {
    headers: authHeader,
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) return null
  const data = await res.json() as { items?: Array<{ id?: string }> }
  return data.items?.[0]?.id ?? null
}

export interface YouTubeVideoStatistics {
  viewCount: number
  likeCount: number
  commentCount: number
}

/**
 * Get view/like/comment counts for videos (engagement JÁ ALCANÇADO, não
 * potencial — ver brand-brazil-launch.ts). videos.list aceita até 50 IDs por
 * chamada; batching automático se passar disso.
 * Costa 1 quota unit por chamada, independente do nº de IDs no batch.
 * likeCount pode vir ausente se o criador desabilitou contagem pública — cai
 * pra 0 nesse caso (indistinguível de "zero curtidas" pela API).
 */
export async function getVideoStatistics(videoIds: string[]): Promise<Record<string, YouTubeVideoStatistics>> {
  if (!videoIds.length) return {}

  const apiKey = getApiKey()
  let authHeader: Record<string, string> = {}
  let keyParam = ''

  if (apiKey) {
    keyParam = `&key=${encodeURIComponent(apiKey)}`
  } else {
    const token = await getOAuthToken()  // throws on failure
    if (!token) throw new Error('No YouTube auth: set YOUTUBE_API_KEY or YOUTUBE_REFRESH_TOKEN')
    authHeader = { Authorization: `Bearer ${token}` }
  }

  const result: Record<string, YouTubeVideoStatistics> = {}
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    const params = new URLSearchParams({ part: 'statistics', id: batch.join(',') })

    const res = await fetch(`${YOUTUBE_API_BASE}/videos?${params}${keyParam}`, {
      headers: authHeader,
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`YouTube statistics failed (${res.status}): ${body.slice(0, 200)}`)
    }
    const data = await res.json() as {
      items?: Array<{ id?: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }>
    }
    for (const item of data.items ?? []) {
      if (!item.id) continue
      result[item.id] = {
        viewCount: Number(item.statistics?.viewCount ?? 0),
        likeCount: Number(item.statistics?.likeCount ?? 0),
        commentCount: Number(item.statistics?.commentCount ?? 0),
      }
    }
  }
  return result
}

/**
 * Get latest videos from a specific YouTube channel.
 * Costs 100 quota units per call.
 * sinceVideoId: stop pagination when this video ID is encountered (dedup against previous run).
 */
export async function getChannelLatestVideos(
  channelId: string,
  sinceVideoId?: string,
  maxResults = 10,
): Promise<YouTubeVideoItem[]> {
  const apiKey = getApiKey()
  let authHeader: Record<string, string> = {}
  let keyParam = ''

  if (apiKey) {
    keyParam = `&key=${encodeURIComponent(apiKey)}`
  } else {
    const token = await getOAuthToken()  // throws on failure
    if (!token) throw new Error('No YouTube auth: set YOUTUBE_API_KEY or YOUTUBE_REFRESH_TOKEN')
    authHeader = { Authorization: `Bearer ${token}` }
  }

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    order: 'date',
    videoDuration: 'short',
    channelId,
    maxResults: String(maxResults),
  })

  const res = await fetch(`${YOUTUBE_API_BASE}/search?${params}${keyParam}`, {
    headers: authHeader,
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`YouTube channel ${channelId} failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const data = await res.json() as { items?: YTSearchItem[] }
  const items = (data.items ?? []).map(mapItem).filter((v): v is YouTubeVideoItem => v !== null)
  if (sinceVideoId) {
    const cutoff = items.findIndex(v => v.videoId === sinceVideoId)
    return cutoff >= 0 ? items.slice(0, cutoff) : items
  }
  return items
}
