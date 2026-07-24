import { createHmac } from 'crypto'
import type { PlatformAdapter, PlatformPost, PublishResult, SearchOptions } from '../platform-adapter'
import { searchTweetsIO, getTrendingIO, getUserTimelineIO } from './twitterapi-io'

// ── OAuth 1.0a helpers (ported from social-machine v1) ──

function oauthEncode(input: string): string {
  return encodeURIComponent(input).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function hmacSha1(key: string, message: string): string {
  return createHmac('sha1', key).update(message).digest('base64')
}

function buildOAuthHeader(
  method: string,
  url: string,
  queryParams: Record<string, string>,
  creds: XCredentials,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: '1.0',
  }

  const allParams = { ...oauthParams, ...queryParams }
  const normalized = Object.entries(allParams)
    .map(([k, v]) => [oauthEncode(k), oauthEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const sigBase = `${method}&${oauthEncode(url)}&${oauthEncode(normalized)}`
  const sigKey = `${oauthEncode(creds.apiSecret)}&${oauthEncode(creds.accessTokenSecret)}`
  oauthParams.oauth_signature = hmacSha1(sigKey, sigBase)

  return 'OAuth ' + Object.keys(oauthParams).sort().map(k => `${oauthEncode(k)}="${oauthEncode(oauthParams[k])}"`).join(', ')
}

// ── Fetch with timeout & retry (ported from v1) ──

const DEFAULT_FETCH_TIMEOUT_MS = 15_000
const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504])
const RETRY_DELAY_MS = 5_000

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  label: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const doFetch = () => fetchWithTimeout(url, options, timeoutMs)
  const res = await doFetch()
  if (TRANSIENT_STATUS_CODES.has(res.status)) {
    console.warn(`[x-client][retry] ${label}: HTTP ${res.status}, retrying in ${RETRY_DELAY_MS / 1000}s...`)
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    return await doFetch()
  }
  return res
}

// ── Types ──

interface XCredentials {
  apiKey: string
  apiSecret: string
  accessToken: string
  accessTokenSecret: string
}

interface XMedia {
  media_key: string
  type: string // 'photo' | 'video' | 'animated_gif'
  url?: string
  preview_image_url?: string
  variants?: Array<{ content_type: string; url: string; bit_rate?: number }>
}

interface XSearchUser {
  id: string
  username: string
  public_metrics?: {
    followers_count?: number
    following_count?: number
  }
  verified?: boolean
}

interface XSearchTweet {
  id: string
  text: string
  author_id?: string
  created_at?: string
  conversation_id?: string
  public_metrics?: {
    like_count?: number
    retweet_count?: number
    reply_count?: number
    quote_count?: number
    impression_count?: number
  }
  attachments?: {
    media_keys?: string[]
  }
  referenced_tweets?: Array<{ type?: string; id?: string }>
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError'
}

// ── Client ──

export class XClient implements PlatformAdapter {
  readonly platform = 'x'
  private credentials: XCredentials
  private cachedUserId: string | null = null
  private searchDisabled = false
  private publishDisabled = false
  private bearerToken: string | null = null
  private useBearer = false // Switch to bearer auth for search after 402

  constructor(credentials: XCredentials) {
    this.credentials = credentials
  }

  static fromEnv(): XClient {
    return new XClient({
      apiKey: process.env.TWITTER_API_KEY!,
      apiSecret: process.env.TWITTER_API_SECRET!,
      accessToken: process.env.TWITTER_ACCESS_TOKEN!,
      accessTokenSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET!,
    })
  }

  // ── Private helpers ──

  private buildAuth(method: string, url: string, queryParams: Record<string, string> = {}): string {
    return buildOAuthHeader(method, url, queryParams, this.credentials)
  }

  private buildQueryString(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
  }

  /**
   * Resolves the authenticated user's ID (needed for like/unlike).
   * Caches the result in memory after the first call.
   */
  private async resolveUserId(): Promise<string> {
    if (this.cachedUserId) return this.cachedUserId

    const url = 'https://api.x.com/2/users/me'
    const auth = this.buildAuth('GET', url)
    const res = await fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: auth },
    }, 'resolveUserId')

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`[x-client] Failed to resolve user ID: HTTP ${res.status} — ${body}`)
    }

    const data = await res.json()
    this.cachedUserId = data.data.id
    console.log(`[x-client] Resolved user ID: ${this.cachedUserId}`)
    return this.cachedUserId!
  }

  // ── PlatformAdapter methods ──

  /**
   * Search with twitterapi.io as primary, official API as fallback.
   */
  async searchWithFallback(options: SearchOptions): Promise<PlatformPost[]> {
    const ioResult = await searchTweetsIO(options.query, options.maxResults)
    if (ioResult !== null) {
      console.log(`[x-client] search via twitterapi.io: ${ioResult.length} results`)
      return ioResult
    }
    console.warn('[x-client] twitterapi.io search failed, falling back to api.x.com')
    return this.search(options)
  }

  /**
   * Get trending topics with twitterapi.io as primary, official API as fallback.
   */
  async getTrendingWithFallback(woeid = 1): Promise<Array<{ name: string; tweetCount: number | null }>> {
    const ioResult = await getTrendingIO(woeid)
    if (ioResult !== null) {
      console.log(`[x-client] trending via twitterapi.io: ${ioResult.length} trends`)
      return ioResult
    }
    console.warn('[x-client] twitterapi.io trending failed, falling back to api.x.com')
    return this.getTrending(woeid)
  }

  /**
   * Get user timeline with twitterapi.io as primary, official API as fallback.
   */
  async searchFromUserWithFallback(username: string, maxResults = 10): Promise<PlatformPost[]> {
    const userId = process.env.TWITTERAPI_IO_USER_ID
    // Use IO timeline only when fetching our own account (userId env matches)
    // For other accounts, fall back to search-based approach
    const ioResult = await getUserTimelineIO(userId ?? '', maxResults)
    if (ioResult !== null && userId) {
      console.log(`[x-client] timeline via twitterapi.io: ${ioResult.length} tweets`)
      return ioResult
    }
    return this.searchFromUser(username, maxResults)
  }

  async search(options: SearchOptions): Promise<PlatformPost[]> {
    if (this.searchDisabled) return []

    const url = 'https://api.x.com/2/tweets/search/recent'
    const qp: Record<string, string> = {
      query: options.query,
      max_results: String(Math.min(Math.max(options.maxResults ?? 10, 10), 100)),
      'tweet.fields': 'text,created_at,public_metrics,attachments,author_id,conversation_id,referenced_tweets,in_reply_to_user_id',
      expansions: 'attachments.media_keys,author_id,referenced_tweets.id',
      'media.fields': 'url,preview_image_url,type,variants',
      'user.fields': 'username,public_metrics,verified',
    }
    if (options.sinceId) qp.since_id = options.sinceId

    const qs = this.buildQueryString(qp)

    // Use bearer token (app-only auth) — works even when OAuth 1.0a returns 402
    let authHeader: string
    if (this.useBearer) {
      const bearer = await this.getBearerToken()
      if (!bearer) { this.searchDisabled = true; return [] }
      authHeader = `Bearer ${bearer}`
    } else {
      authHeader = this.buildAuth('GET', url, qp)
    }

    let res: Response
    try {
      res = await fetchWithRetry(`${url}?${qs}`, {
        method: 'GET',
        headers: { Authorization: authHeader },
      }, `search(${options.query})`)
    } catch (e: unknown) {
      console.error(`[x-client] search timeout/error:`, getErrorName(e))
      return []
    }

    if (!res.ok) {
      if ((res.status === 402 || res.status === 403) && !this.useBearer) {
        console.warn(`[x-client] OAuth search got ${res.status}, switching to Bearer token`)
        this.useBearer = true
        return this.search(options) // Retry with bearer
      }
      if (res.status === 402 || res.status === 403) {
        this.searchDisabled = true
        const errBody = await res.text().catch(() => '')
        // Throw so callers (curator, engagement-external) record the error and trigger alerts
        throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 300)}`)
      }
      console.error(`[x-client] search failed: HTTP ${res.status}`)
      return []
    }

    const body = await res.json() as {
      data?: XSearchTweet[]
      includes?: { media?: XMedia[]; users?: XSearchUser[] }
    }
    const tweets = body.data ?? []

    // Build media lookup
    const mediaMap = new Map<string, XMedia>()
    for (const m of (body.includes?.media || []) as XMedia[]) {
      mediaMap.set(m.media_key, m)
    }

    // Build author lookup with follower counts and verified status
    const authorMap = new Map<string, { username: string; followers: number; following: number; verified: boolean }>()
    for (const u of body.includes?.users || []) {
      authorMap.set(u.id, {
        username: u.username,
        followers: u.public_metrics?.followers_count ?? 0,
        following: u.public_metrics?.following_count ?? 0,
        verified: u.verified ?? false,
      })
    }

    return tweets.map((t) => {
      const metrics = t.public_metrics || {}
      const authorData = t.author_id ? authorMap.get(t.author_id) : undefined
      const author = authorData?.username || t.author_id || 'unknown'
      const repliedTo = Array.isArray(t.referenced_tweets)
        ? t.referenced_tweets.find((ref: { type?: string; id?: string }) => ref.type === 'replied_to')
        : null

      // Extract media URLs and detect video
      const mediaKeys: string[] = t.attachments?.media_keys || []
      let videoUrl: string | null = null
      const mediaUrls = mediaKeys
        .map((key: string) => {
          const m = mediaMap.get(key)
          if (m?.type === 'video' || m?.type === 'animated_gif') {
            // Pick highest-bitrate MP4 variant
            const mp4Variants = (m.variants ?? []).filter(v => v.content_type === 'video/mp4')
            const best = mp4Variants.sort((a, b) => (b.bit_rate ?? 0) - (a.bit_rate ?? 0))[0]
            if (best?.url && !videoUrl) videoUrl = best.url
            return m.preview_image_url || null
          }
          return m?.url || m?.preview_image_url || null
        })
        .filter((u): u is string => u !== null)

      const mediaTypes = mediaKeys.map((key: string) => {
        const m = mediaMap.get(key)
        if (m?.type === 'video') return 'video'
        if (m?.type === 'animated_gif') return 'animated_gif'
        return 'photo'
      })

      return {
        id: t.id,
        url: `https://x.com/${author}/status/${t.id}`,
        text: t.text,
        author,
        conversationId: t.conversation_id ?? null,
        inReplyToId: repliedTo?.id ?? null,
        inReplyToUsername: null,
        metrics: {
          likes: metrics.like_count ?? 0,
          retweets: metrics.retweet_count ?? 0,
          replies: metrics.reply_count ?? 0,
          views: metrics.impression_count ?? 0,
        },
        createdAt: t.created_at || new Date().toISOString(),
        mediaUrls,
        mediaTypes,
        videoUrl,
        authorFollowers: authorData?.followers ?? 0,
        authorFollowing: authorData?.following ?? 0,
        authorVerified: authorData?.verified ?? false,
        quoteCount: metrics.quote_count ?? 0,
      } satisfies PlatformPost & { mediaUrls: string[]; mediaTypes: string[]; videoUrl: string | null; authorFollowers: number; authorFollowing: number; authorVerified: boolean; quoteCount: number }
    }) as PlatformPost[]
  }

  async publish(text: string): Promise<PublishResult> {
    if (this.publishDisabled) return { success: false, error: 'Publishing disabled (credits depleted)' }

    const url = 'https://api.x.com/2/tweets'
    const auth = this.buildAuth('POST', url)

    let res: Response
    try {
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      }, 'publish')
    } catch (e: unknown) {
      console.error(`[x-client] publish timeout/error:`, getErrorName(e))
      return { success: false, error: `Network error: ${getErrorMessage(e)}` }
    }

    if (!res.ok) {
      const body = await res.text()
      if (res.status === 402) {
        console.error(`[x-client] 🔴 Credits depleted — disabling publish for this session`)
        this.publishDisabled = true
      }
      console.error(`[x-client] publish failed: HTTP ${res.status} — ${body}`)
      return { success: false, error: `HTTP ${res.status}: ${body}` }
    }

    const data = await res.json()
    const tweetId = data.data?.id
    console.log(`[x-client] Published tweet ${tweetId}`)

    return {
      success: true,
      postId: tweetId,
      postUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined,
    }
  }

  /**
   * Publish a tweet with a video attachment (mp4).
   * Uses Twitter's chunked media upload (INIT → APPEND → FINALIZE → await processing).
   */
  async publishWithVideo(text: string, videoUrl: string): Promise<PublishResult> {
    try {
      // 1. Download video
      const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) })
      if (!vidRes.ok) {
        console.error(`[x-client] Video download failed: ${vidRes.status}`)
        return { success: false, error: `VideoDownloadFailed: HTTP ${vidRes.status}` }
      }
      const vidBuffer = Buffer.from(await vidRes.arrayBuffer())
      const totalBytes = vidBuffer.byteLength
      const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json'

      // 2. INIT — body params must be included in OAuth signature for x-www-form-urlencoded
      const initBodyParams = { command: 'INIT', media_type: 'video/mp4', media_category: 'tweet_video', total_bytes: String(totalBytes) }
      const initAuth = this.buildAuth('POST', uploadUrl, initBodyParams)
      const initRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: initAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(initBodyParams).toString(),
      })
      if (!initRes.ok) {
        const errBody = await initRes.text().catch(() => '')
        console.error(`[x-client] Video INIT failed: ${initRes.status} — ${errBody}`)
        return { success: false, error: `VideoInitFailed: HTTP ${initRes.status}` }
      }
      const initData = await initRes.json() as { media_id_string?: string }
      const mediaId = initData.media_id_string
      if (!mediaId) return { success: false, error: 'VideoInitFailed: no media_id returned' }

      // 3. APPEND (5 MB chunks)
      const chunkSize = 5 * 1024 * 1024
      let segmentIndex = 0
      for (let offset = 0; offset < totalBytes; offset += chunkSize) {
        const chunk = vidBuffer.slice(offset, offset + chunkSize)
        const appendAuth = this.buildAuth('POST', uploadUrl)
        const formParts: Buffer[] = []
        const boundary = `----Boundary${Date.now()}${segmentIndex}`
        const header = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="command"\r\n\r\nAPPEND\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="media_id"\r\n\r\n${mediaId}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="segment_index"\r\n\r\n${segmentIndex}\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="chunk.mp4"\r\nContent-Type: video/mp4\r\n\r\n`
        )
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
        formParts.push(header, chunk, footer)
        const appendRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { Authorization: appendAuth, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
          body: Buffer.concat(formParts),
        })
        if (!appendRes.ok) {
          console.error(`[x-client] Video APPEND chunk ${segmentIndex} failed: ${appendRes.status}`)
          return { success: false, error: `VideoAppendFailed: chunk ${segmentIndex} HTTP ${appendRes.status}` }
        }
        segmentIndex++
      }

      // 4. FINALIZE — body params must be included in OAuth signature for x-www-form-urlencoded
      const finalizeBodyParams = { command: 'FINALIZE', media_id: mediaId }
      const finalizeAuth = this.buildAuth('POST', uploadUrl, finalizeBodyParams)
      const finalizeRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: finalizeAuth, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(finalizeBodyParams).toString(),
      })
      if (!finalizeRes.ok) {
        console.error(`[x-client] Video FINALIZE failed: ${finalizeRes.status}`)
        return { success: false, error: `VideoFinalizeFailed: HTTP ${finalizeRes.status}` }
      }
      const finalizeData = await finalizeRes.json() as { processing_info?: { state: string; check_after_secs?: number } }

      // 5. Poll until processing is complete
      let processingInfo = finalizeData.processing_info
      while (processingInfo && processingInfo.state !== 'succeeded' && processingInfo.state !== 'failed') {
        const waitSecs = processingInfo.check_after_secs ?? 5
        await new Promise(r => setTimeout(r, waitSecs * 1000))
        const statusAuth = this.buildAuth('GET', uploadUrl, { command: 'STATUS', media_id: mediaId })
        const statusRes = await fetch(`${uploadUrl}?command=STATUS&media_id=${mediaId}`, {
          headers: { Authorization: statusAuth },
        })
        if (!statusRes.ok) break
        const statusData = await statusRes.json() as { processing_info?: { state: string; check_after_secs?: number } }
        processingInfo = statusData.processing_info
      }

      if (processingInfo?.state === 'failed') {
        console.error('[x-client] Video processing failed by Twitter')
        return { success: false, error: 'VideoProcessingFailed: Twitter rejected the video' }
      }

      // 6. Create tweet with video
      const tweetUrl = 'https://api.x.com/2/tweets'
      const tweetAuth = this.buildAuth('POST', tweetUrl)
      const res = await fetchWithRetry(tweetUrl, {
        method: 'POST',
        headers: { Authorization: tweetAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, media: { media_ids: [mediaId] } }),
      }, 'publishWithVideo')

      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `HTTP ${res.status}: ${body}` }
      }

      const data = await res.json()
      const tweetId = data.data?.id
      console.log(`[x-client] Published tweet with video: ${tweetId}`)
      return { success: true, postId: tweetId, postUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined }
    } catch (err) {
      console.error('[x-client] publishWithVideo error:', err)
      return { success: false, error: `VideoUploadError: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Publish a tweet with an image attachment.
   * Downloads the image, uploads to Twitter media endpoint, then creates tweet.
   */
  async publishWithMedia(text: string, imageUrl: string): Promise<PublishResult> {
    try {
      // 1. Download image
      const imgRes = await fetch(imageUrl)
      if (!imgRes.ok) return { success: false, error: `ImageDownloadFailed: HTTP ${imgRes.status}` }

      const imgBuffer = Buffer.from(await imgRes.arrayBuffer())
      // 2. Upload to Twitter media endpoint (v1.1)
      const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json'
      const boundary = `----FormBoundary${Date.now()}`

      const formParts: Buffer[] = []
      formParts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="media_data"\r\n\r\n${imgBuffer.toString('base64')}\r\n--${boundary}--\r\n`
      ))
      const formBody = Buffer.concat(formParts)

      const uploadAuth = this.buildAuth('POST', uploadUrl)
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: uploadAuth,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: formBody,
      })

      if (!uploadRes.ok) {
        console.error(`[x-client] Media upload failed: ${uploadRes.status}`)
        return { success: false, error: `ImageUploadFailed: HTTP ${uploadRes.status}` }
      }

      const uploadData = await uploadRes.json() as { media_id_string?: string }
      const mediaId = uploadData.media_id_string
      if (!mediaId) return { success: false, error: 'ImageUploadFailed: no media_id returned' }

      // 3. Create tweet with media
      const tweetUrl = 'https://api.x.com/2/tweets'
      const tweetAuth = this.buildAuth('POST', tweetUrl)

      const res = await fetchWithRetry(tweetUrl, {
        method: 'POST',
        headers: { Authorization: tweetAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          media: { media_ids: [mediaId] },
        }),
      }, 'publishWithMedia')

      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `HTTP ${res.status}: ${body}` }
      }

      const data = await res.json()
      const tweetId = data.data?.id
      console.log(`[x-client] Published tweet with media: ${tweetId}`)

      return {
        success: true,
        postId: tweetId,
        postUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined,
      }
    } catch (err) {
      console.error('[x-client] publishWithMedia error:', err)
      return { success: false, error: `ImageUploadError: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async reply(postId: string, text: string): Promise<PublishResult> {
    const url = 'https://api.x.com/2/tweets'
    const auth = this.buildAuth('POST', url)

    let res: Response
    try {
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text,
          reply: { in_reply_to_tweet_id: postId },
        }),
      }, `reply(${postId})`)
    } catch (e: unknown) {
      console.error(`[x-client] reply timeout/error:`, getErrorName(e))
      return { success: false, error: `Network error: ${getErrorMessage(e)}` }
    }

    if (!res.ok) {
      const body = await res.text()
      console.error(`[x-client] reply failed: HTTP ${res.status} — ${body}`)
      return { success: false, error: `HTTP ${res.status}: ${body}` }
    }

    const data = await res.json()
    const tweetId = data.data?.id
    console.log(`[x-client] Replied to ${postId} with tweet ${tweetId}`)

    return {
      success: true,
      postId: tweetId,
      postUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined,
    }
  }

  /**
   * Quote tweet — repost with commentary. Higher visibility than replies.
   */
  async quoteTweet(tweetUrl: string, text: string): Promise<PublishResult> {
    const url = 'https://api.x.com/2/tweets'
    const auth = this.buildAuth('POST', url)

    try {
      const res = await fetchWithRetry(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, quote_tweet_id: tweetUrl.split('/').pop() }),
      }, 'quoteTweet')

      if (!res.ok) {
        const body = await res.text()
        return { success: false, error: `HTTP ${res.status}: ${body}` }
      }

      const data = await res.json()
      const tweetId = data.data?.id
      console.log(`[x-client] Quote tweet: ${tweetId}`)
      return { success: true, postId: tweetId, postUrl: tweetId ? `https://x.com/i/status/${tweetId}` : undefined }
    } catch (e: unknown) {
      return { success: false, error: `Network error: ${getErrorMessage(e)}` }
    }
  }

  async retweet(tweetId: string): Promise<boolean> {
    let userId: string
    try {
      userId = await this.resolveUserId()
    } catch (e: unknown) {
      console.error(`[x-client] retweet failed — could not resolve user ID:`, getErrorMessage(e))
      return false
    }

    const url = `https://api.x.com/2/users/${userId}/retweets`
    const auth = this.buildAuth('POST', url)

    let res: Response
    try {
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweet_id: tweetId }),
      }, `retweet(${tweetId})`)
    } catch (e: unknown) {
      console.error(`[x-client] retweet timeout/error:`, getErrorName(e))
      return false
    }

    if (!res.ok) {
      const body = await res.text()
      console.error(`[x-client] retweet failed: HTTP ${res.status} — ${body}`)
      return false
    }

    console.log(`[x-client] Retweeted ${tweetId}`)
    return true
  }

  async like(postId: string): Promise<boolean> {
    let userId: string
    try {
      userId = await this.resolveUserId()
    } catch (e: unknown) {
      console.error(`[x-client] like failed — could not resolve user ID:`, getErrorMessage(e))
      return false
    }

    const url = `https://api.x.com/2/users/${userId}/likes`
    const auth = this.buildAuth('POST', url)

    let res: Response
    try {
      res = await fetchWithRetry(url, {
        method: 'POST',
        headers: {
          Authorization: auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tweet_id: postId }),
      }, `like(${postId})`)
    } catch (e: unknown) {
      console.error(`[x-client] like timeout/error:`, getErrorName(e))
      return false
    }

    if (!res.ok) {
      const body = await res.text()
      console.error(`[x-client] like failed: HTTP ${res.status} — ${body}`)
      return false
    }

    console.log(`[x-client] Liked tweet ${postId}`)
    return true
  }

  async getTrending(woeid = 1): Promise<Array<{ name: string; tweetCount: number | null }>> {
    // Trending requires App-Only Bearer Token (OAuth 2.0)
    const bearerToken = await this.getBearerToken()
    if (!bearerToken) return []

    try {
      const res = await fetch(`https://api.x.com/2/trends/by/woeid/${woeid}`, {
        headers: { Authorization: `Bearer ${bearerToken}` },
      })
      if (!res.ok) return []

      const data = await res.json()
      return (data.data ?? []).map((t: { trend_name: string; tweet_count?: number }) => ({
        name: t.trend_name,
        tweetCount: t.tweet_count ?? null,
      }))
    } catch {
      return []
    }
  }

  /**
   * Search tweets from a specific user profile.
   */
  async searchFromUser(username: string, maxResults = 10): Promise<PlatformPost[]> {
    return this.search({ query: `from:${username} -is:retweet`, maxResults })
  }

  async searchVideosFromUser(username: string, maxResults = 10): Promise<PlatformPost[]> {
    return this.search({ query: `from:${username} has:video -is:retweet`, maxResults })
  }

  private cachedBearerToken: string | null = null

  private async getBearerToken(): Promise<string | null> {
    if (this.cachedBearerToken) return this.cachedBearerToken

    const basic = Buffer.from(
      `${encodeURIComponent(this.credentials.apiKey)}:${encodeURIComponent(this.credentials.apiSecret)}`
    ).toString('base64')

    try {
      const res = await fetch('https://api.x.com/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      })
      const data = await res.json()
      this.cachedBearerToken = data.access_token ?? null
      return this.cachedBearerToken
    } catch {
      return null
    }
  }
}
