/**
 * TwitterAPI.io client — alternative search API without credit limits.
 * Used for viral keyword discovery (Source 1 in curator).
 * Docs: https://docs.twitterapi.io/api-reference/endpoint/tweet_advanced_search
 */

import type { PlatformPost } from '../platform-adapter'

const BASE_URL = 'https://api.twitterapi.io'
const ENDPOINT = '/twitter/tweet/advanced_search'

interface TwitterApiIoMedia {
  type?: 'photo' | 'video' | 'animated_gif'
  media_url_https?: string
  url?: string
  video_info?: {
    variants?: Array<{ content_type?: string; bitrate?: number; url?: string }>
  }
}

export interface TwitterApiIoTweet {
  id: string
  text: string
  createdAt: string
  author: {
    userName: string
    name: string
    id: string
    followers?: number
    isBlueVerified?: boolean
  }
  lang?: string
  likeCount?: number
  retweetCount?: number
  replyCount?: number
  quoteCount?: number
  viewCount?: number
  url?: string
  isReply?: boolean
  inReplyToId?: string
  conversationId?: string
  inReplyToUserId?: string
  inReplyToUsername?: string
  // Media fields returned by TwitterAPI.io (Twitter v1.1 format)
  extendedEntities?: { media?: TwitterApiIoMedia[] }
  entities?: { media?: TwitterApiIoMedia[] }
}

/**
 * Extract mediaUrls, mediaTypes, and videoUrl from a TwitterAPI.io tweet.
 * TwitterAPI.io returns media in extendedEntities (primary) or entities (fallback).
 */
export function extractMediaFromIoTweet(t: TwitterApiIoTweet): {
  mediaUrls: string[]
  mediaTypes: string[]
  videoUrl: string | null
  hasMedia: boolean
} {
  const mediaItems = t.extendedEntities?.media ?? t.entities?.media ?? []
  if (!mediaItems.length) return { mediaUrls: [], mediaTypes: [], videoUrl: null, hasMedia: false }

  const mediaUrls: string[] = []
  const mediaTypes: string[] = []
  let videoUrl: string | null = null

  for (const m of mediaItems) {
    const type = m.type ?? 'photo'
    mediaTypes.push(type)

    if ((type === 'video' || type === 'animated_gif') && m.video_info?.variants?.length) {
      // Cap at ~2.5Mbps to avoid 4K variants — Railway can't process 4K in time
      // and Instagram can't download Twitter URLs directly.
      // 2.5Mbps covers up to 1080p; 4K variants are typically 4-10Mbps.
      const MAX_BITRATE = 2_500_000
      const mp4Variants = m.video_info.variants
        .filter(v => v.content_type === 'video/mp4' && v.url)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))
      // Prefer highest bitrate ≤ MAX_BITRATE; fall back to lowest available if all exceed it
      const preferred = mp4Variants.find(v => (v.bitrate ?? 0) <= MAX_BITRATE) ?? mp4Variants[mp4Variants.length - 1]
      if (preferred?.url) {
        videoUrl = preferred.url
        mediaUrls.push(videoUrl)
      }
    } else if (m.media_url_https) {
      mediaUrls.push(m.media_url_https)
    }
  }

  return { mediaUrls, mediaTypes, videoUrl, hasMedia: mediaUrls.length > 0 }
}

interface SearchResponse {
  tweets?: TwitterApiIoTweet[]
  data?: TwitterApiIoTweet[]
  has_next_page?: boolean
  next_cursor?: string
}

export interface TwitterApiIoSearchResult {
  tweets: TwitterApiIoTweet[]
  nextCursor?: string
  hasNextPage: boolean
}

/**
 * Search tweets via TwitterAPI.io. One page (up to 20 tweets).
 */
export async function searchTwitterApiIo(
  query: string,
  apiKey: string,
  options?: { queryType?: 'Latest' | 'Top'; sinceTimeUnix?: number; cursor?: string }
): Promise<TwitterApiIoSearchResult> {
  let finalQuery = query
  if (options?.sinceTimeUnix) {
    finalQuery = `${finalQuery} since_time:${options.sinceTimeUnix}`
  }

  const url = new URL(BASE_URL + ENDPOINT)
  url.searchParams.set('query', finalQuery)
  url.searchParams.set('queryType', options?.queryType ?? 'Latest')
  if (options?.cursor) url.searchParams.set('cursor', options.cursor)

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TwitterAPI.io ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = (await res.json()) as SearchResponse
  const tweets = json.tweets ?? json.data ?? []

  return {
    tweets,
    nextCursor: json.next_cursor,
    hasNextPage: Boolean(json.has_next_page),
  }
}

/**
 * Search tweets and return PlatformPost[] format.
 * Returns null if API key is missing (signals caller to use fallback).
 */
export async function searchTweetsIO(
  query: string,
  maxResults = 10,
  queryType: 'Latest' | 'Top' = 'Latest'
): Promise<PlatformPost[] | null> {
  const apiKey = process.env.TWITTERAPI_IO_KEY
  if (!apiKey) return null

  try {
    const result = await searchTwitterApiIo(query, apiKey, { queryType })
    const tweets = result.tweets.slice(0, maxResults)
    return tweets.map((t) => ({
      id: t.id,
      url: t.url ?? `https://x.com/${t.author?.userName}/status/${t.id}`,
      text: t.text,
      author: t.author?.userName ?? '',
      conversationId: t.conversationId ?? null,
      inReplyToId: t.inReplyToId ?? null,
      inReplyToUsername: t.inReplyToUsername ?? null,
      metrics: {
        likes: t.likeCount ?? 0,
        retweets: t.retweetCount ?? 0,
        replies: t.replyCount ?? 0,
        views: t.viewCount ?? 0,
      },
      createdAt: t.createdAt ?? new Date().toISOString(),
    }))
  } catch {
    return null
  }
}

/**
 * Get trending topics via TwitterAPI.io.
 * Returns null if API key is missing.
 */
export async function getTrendingIO(
  _woeid = 1
): Promise<Array<{ name: string; tweetCount: number | null }> | null> {
  void _woeid
  const apiKey = process.env.TWITTERAPI_IO_KEY
  if (!apiKey) return null

  try {
    const result = await searchTwitterApiIo('(AI OR tech) lang:en', apiKey, { queryType: 'Top' })
    return result.tweets.slice(0, 20).map((t) => ({
      name: t.text.slice(0, 60),
      tweetCount: t.likeCount ?? null,
    }))
  } catch {
    return null
  }
}

/**
 * Get user timeline via TwitterAPI.io.
 * Returns null if API key is missing.
 */
export async function getUserTimelineIO(
  userId: string,
  maxResults = 10
): Promise<PlatformPost[] | null> {
  if (!userId) return null
  const apiKey = process.env.TWITTERAPI_IO_KEY
  if (!apiKey) return null

  try {
    const result = await searchTwitterApiIo(`from:${userId} -is:retweet`, apiKey, { queryType: 'Latest' })
    const tweets = result.tweets.slice(0, maxResults)
    return tweets.map((t) => ({
      id: t.id,
      url: t.url ?? `https://x.com/${t.author?.userName}/status/${t.id}`,
      text: t.text,
      author: t.author?.userName ?? '',
      conversationId: t.conversationId ?? null,
      inReplyToId: t.inReplyToId ?? null,
      inReplyToUsername: t.inReplyToUsername ?? null,
      metrics: {
        likes: t.likeCount ?? 0,
        retweets: t.retweetCount ?? 0,
        replies: t.replyCount ?? 0,
        views: t.viewCount ?? 0,
      },
      createdAt: t.createdAt ?? new Date().toISOString(),
    }))
  } catch {
    return null
  }
}
