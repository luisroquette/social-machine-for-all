/**
 * Instagram Graph API client.
 * Publishes images/carousels via the 2-step container flow.
 * Text-only posts are NOT supported by Instagram API.
 */

import type { PlatformAdapter, PublishResult, SearchOptions, PlatformPost } from '../platform-adapter'
import { publishFinishedContainer } from './publish-container'
import { reviewInstagramVisualQuality } from '@/lib/eval/instagram-visual-quality'

interface InstagramCredentials {
  appId: string
  accessToken: string
  igUserId: string
}

interface CarouselItem {
  type: 'image' | 'video'
  url: string
}

import { INSTAGRAM_API_BASE } from '@/lib/config/constants'

const GRAPH_API_BASE = INSTAGRAM_API_BASE

const HASHTAG_REGEX = /#[\w\u00C0-\u017E]+/g

// D1: Real Instagram Android User-Agents — rotated per request to avoid bot UA fingerprint
const IG_USER_AGENTS = [
  'Instagram 275.0.0.27.98 Android (31/12; 420dpi; 1080x2340; samsung; SM-G991B; o1s; exynos2100; pt_BR; 453670638)',
  'Instagram 274.0.0.24.102 Android (30/11; 440dpi; 1080x2160; OnePlus; IN2023; OnePlus8T; qcom; pt_BR; 452047668)',
  'Instagram 269.0.0.18.75 Android (32/12; 480dpi; 1080x2400; Google; Pixel 6; oriole; oriole; pt_BR; 445380839)',
  'Instagram 278.0.0.20.115 Android (29/11; 420dpi; 1080x2280; Xiaomi; Mi 9T; davinci; qcom; pt_BR; 457841203)',
  'Instagram 271.0.0.27.98 Android (33/13; 440dpi; 1080x2408; samsung; SM-S908B; b0q; exynos2200; pt_BR; 447651234)',
]

export function getRandomUA(): string {
  return IG_USER_AGENTS[Math.floor(Math.random() * IG_USER_AGENTS.length)]
}

// B1: Parenthetical asides for ~20% micro-variation (breaks repetitive caption structure fingerprint)
const CAPTION_ASIDES = [
  '\n(se você chegou até aqui, já está à frente de 90% do mercado.)',
  '\n(isso ainda vai surpreender muita gente.)',
  '\n(anota esse número.)',
]

/**
 * Apply ~20% micro-variation to caption to avoid repetitive structure fingerprint (B1).
 * Called before every IG publish to vary trailing punctuation, asides, and CTA casing.
 */
export function applyMicroVariation(caption: string): string {
  if (Math.random() > 0.20) return caption
  const r = Math.floor(Math.random() * 3)
  if (r === 0) {
    // Swap trailing period for ellipsis — softer close, less "AI-finished" feel
    return caption.replace(/\.\s*$/, '...')
  }
  if (r === 1) {
    // Insert a parenthetical aside before the last paragraph
    const lastBreak = caption.lastIndexOf('\n\n')
    if (lastBreak !== -1) {
      const aside = CAPTION_ASIDES[Math.floor(Math.random() * CAPTION_ASIDES.length)]
      return caption.slice(0, lastBreak) + aside + caption.slice(lastBreak)
    }
    return caption
  }
  // r === 2: lowercase CTA opener on last paragraph for organic feel
  return caption.replace(/(^|\n\n)([A-ZÁÉÍÓÚ])([a-záéíóúãõâêô].{0,40}[👉→])/, (_, nl, c, rest) => nl + c.toLowerCase() + rest)
}

/** Strip hashtags from caption and return them separately.
 *  Anti-shadowban: hashtags in caption = bot fingerprint. Post them as first comment instead.
 */
export function splitHashtags(caption: string): { cleanCaption: string; hashtags: string } {
  const hashtags = (caption.match(HASHTAG_REGEX) ?? []).join(' ')
  const cleanCaption = caption.replace(HASHTAG_REGEX, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { cleanCaption, hashtags }
}

export class InstagramClient implements PlatformAdapter {
  readonly platform = 'instagram'
  private credentials: InstagramCredentials

  constructor(credentials: InstagramCredentials) {
    this.credentials = credentials
  }

  static fromEnv(): InstagramClient {
    return new InstagramClient({
      appId: process.env.INSTAGRAM_APP_ID!,
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN!,
      igUserId: process.env.INSTAGRAM_USER_ID!,
    })
  }

  static fromWorkspace(creds: { appId: string; accessToken: string; igUserId: string }): InstagramClient {
    return new InstagramClient(creds)
  }

  private jsonHeaders(): HeadersInit {
    return { 'Content-Type': 'application/json', 'User-Agent': getRandomUA() }
  }

  private getHeaders(): HeadersInit {
    return { 'User-Agent': getRandomUA() }
  }

  private async enforceVisualQuality(
    caption: string,
    format: 'image' | 'carousel' | 'reel',
    assets: CarouselItem[],
  ): Promise<PublishResult> {
    const review = await reviewInstagramVisualQuality({ caption, format, assets })
    const qualityReview = {
      outcome: review.outcome,
      passed: review.passed,
      score: review.score,
      scores: { ...review.scores },
      issues: review.issues,
      improvements: review.improvements,
      feedback: review.feedback,
    }
    return review.passed
      ? { success: true, qualityReview }
      : {
        success: false,
        error: `${review.outcome === 'unavailable' ? 'quality_gate_unavailable' : 'quality_gate_rejected'}:${review.feedback}`,
        qualityReview,
      }
  }

  /**
   * Publish an image post to Instagram.
   * Instagram API requires an image URL — text-only posts are not supported.
   *
   * @param text - Caption text
   * @param imageUrl - Public HTTPS URL of the image
   */
  async publishImage(text: string, imageUrl: string, altText?: string): Promise<PublishResult> {
    const { igUserId, accessToken } = this.credentials
    const qualityCheck = await this.enforceVisualQuality(text, 'image', [{ type: 'image', url: imageUrl }])
    if (!qualityCheck.success) return qualityCheck

    // Step 1: Create media container
    // Had no timeout at all before — a hung call could block indefinitely.
    const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        image_url: imageUrl,
        caption: text,
        access_token: accessToken,
        ...(altText ? { alt_text: altText } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    })

    const containerData = await containerRes.json()

    if (!containerRes.ok || !containerData.id) {
      return {
        success: false,
        error: `Container creation failed: ${containerData.error?.message ?? JSON.stringify(containerData)}`,
      }
    }

    const creationId = containerData.id

    // Poll for container readiness (image processing is usually fast but not instant)
    const ready = await this.waitForContainer(creationId, accessToken, 30_000)
    if (!ready) {
      return { success: false, error: 'Image container processing timed out after 30s' }
    }

    // Step 2: Publish the container
    const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(15_000),
    })

    const publishData = await publishRes.json()

    if (!publishRes.ok || !publishData.id) {
      return {
        success: false,
        error: `Publish failed: ${publishData.error?.message ?? JSON.stringify(publishData)}`,
      }
    }

    // Fetch permalink to get the actual post URL (media_id is not a shortcode)
    const permalink = await this.fetchPermalink(publishData.id, accessToken)

    return {
      success: true,
      postId: publishData.id,
      postUrl: permalink ?? undefined,
      qualityReview: qualityCheck.qualityReview,
    }
  }

  /**
   * Publish a carousel (multiple images) to Instagram.
   */
  async publishCarousel(text: string, imageUrls: string[], altText?: string): Promise<PublishResult> {
    const { igUserId, accessToken } = this.credentials
    const qualityCheck = await this.enforceVisualQuality(
      text,
      'carousel',
      imageUrls.map((url) => ({ type: 'image' as const, url })),
    )
    if (!qualityCheck.success) return qualityCheck

    // Step 1: Create individual containers for each image
    // Had no timeout at all before — a hung call in the loop blocked all remaining items.
    const childIds: string[] = []
    for (const url of imageUrls) {
      const res = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({
          image_url: url,
          is_carousel_item: true,
          access_token: accessToken,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = await res.json()
      if (data.id) childIds.push(data.id)
    }

    if (childIds.length === 0) {
      return { success: false, error: 'No carousel items created' }
    }

    // Step 2: Create carousel container
    const carouselRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children: childIds,
        caption: text,
        access_token: accessToken,
        ...(altText ? { alt_text: altText } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const carouselData = await carouselRes.json()

    if (!carouselData.id) {
      return { success: false, error: `Carousel container failed: ${carouselData.error?.message}` }
    }

    await new Promise(resolve => setTimeout(resolve, 5000))

    // Step 3: Publish
    const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        creation_id: carouselData.id,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const publishData = await publishRes.json()

    if (!publishData.id) {
      return { success: false, error: `Carousel publish failed: ${publishData.error?.message}` }
    }

    return {
      success: true,
      postId: publishData.id,
      postUrl: `https://www.instagram.com/p/${publishData.id}`,
      qualityReview: qualityCheck.qualityReview,
    }
  }

  async publishMixedCarousel(caption: string, items: CarouselItem[], altText?: string): Promise<PublishResult> {
    const { igUserId, accessToken } = this.credentials
    const validItems = items.filter((item) => item.url)

    if (validItems.length < 2) {
      return { success: false, error: 'Carousel requires at least 2 items' }
    }
    const qualityCheck = await this.enforceVisualQuality(caption, 'carousel', validItems)
    if (!qualityCheck.success) return qualityCheck

    const childIds: string[] = []

    for (const [index, item] of validItems.entries()) {
      const body: Record<string, unknown> = {
        is_carousel_item: true,
        access_token: accessToken,
      }

      if (item.type === 'video') {
        body.media_type = 'VIDEO'
        body.video_url = item.url
      } else {
        body.image_url = item.url
        if (altText) body.alt_text = altText
      }

      // Had no timeout at all before — a hung child-container creation call blocked the whole
      // per-item loop indefinitely.
      const res = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      const data = await res.json()

      if (!res.ok || !data.id) {
        return {
          success: false,
          error: `Carousel child ${index + 1} (${item.type}) creation failed: ${data.error?.message ?? JSON.stringify(data)}`,
        }
      }

      // Video cap reduced 120s→60s (was 2x the shared publishReel poll before that was also
      // reduced) — this loop runs PER ITEM, sequentially, inside the same maxDuration as the
      // final carousel container poll below (also reduced) plus everything upstream
      // (video stitching, cover/endcard generation) in trend-video-publish/route.ts.
      const ready = await this.waitForContainer(
        data.id,
        accessToken,
        item.type === 'video' ? 60_000 : 30_000,
        item.type === 'video' ? 5_000 : 2_000,
      )
      if (!ready) {
        return { success: false, error: `Carousel child ${index + 1} (${item.type}) processing timed out or failed` }
      }

      childIds.push(data.id)
    }

    // Had no timeout at all before.
    const carouselRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify({
        media_type: 'CAROUSEL',
        children: childIds,
        caption,
        access_token: accessToken,
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const carouselData = await carouselRes.json()

    if (!carouselRes.ok || !carouselData.id) {
      return {
        success: false,
        error: `Carousel container failed: ${carouselData.error?.message ?? JSON.stringify(carouselData)}`,
      }
    }

    // Reduced 120s→60s (2026-07-15) — this poll runs AFTER the per-item loop above, all
    // inside the same maxDuration shared with video stitching + cover/endcard generation
    // upstream in trend-video-publish/route.ts.
    const ready = await this.waitForContainer(carouselData.id, accessToken, 60_000, 5_000)
    if (!ready) {
      return { success: false, error: 'Carousel processing timed out or failed after 60s' }
    }

    const publishResult = await publishFinishedContainer(
      GRAPH_API_BASE,
      igUserId,
      accessToken,
      carouselData.id,
      3_000,
      5,
    )

    if (!publishResult.id) {
      return {
        success: false,
        error: `Carousel publish failed: ${publishResult.error ?? 'unknown_error'}`,
      }
    }

    const permalink = await this.fetchPermalink(publishResult.id, accessToken)

    return {
      success: true,
      postId: publishResult.id,
      postUrl: permalink ?? undefined,
      qualityReview: qualityCheck.qualityReview,
    }
  }

  /**
   * Publish a Reel (short video) to Instagram.
   * Uses the same container flow but with media_type=REELS and polling for readiness.
   *
   * @param caption - Reel caption text
   * @param videoUrl - Public HTTPS URL to an MP4 (H.264, AAC, 9:16, 3-90s)
   * @param coverUrl - Optional cover image URL
   */
  async publishReel(caption: string, videoUrl: string, coverUrl?: string, altText?: string): Promise<PublishResult> {
    const { igUserId, accessToken } = this.credentials
    const qualityCheck = await this.enforceVisualQuality(caption, 'reel', [
      { type: 'video', url: videoUrl },
      ...(coverUrl ? [{ type: 'image' as const, url: coverUrl }] : []),
    ])
    if (!qualityCheck.success) return qualityCheck

    // Step 1: Create Reels container
    const containerBody: Record<string, unknown> = {
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      share_to_feed: true,
      access_token: accessToken,
    }
    if (coverUrl) containerBody.cover_url = coverUrl
    // NOTE: alt_text is NOT supported for REELS — IG API returns error #100. Param intentionally omitted.

    const containerRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(containerBody),
      signal: AbortSignal.timeout(15_000),
    })

    const containerData = await containerRes.json()

    if (!containerRes.ok || !containerData.id) {
      return {
        success: false,
        error: `Reel container creation failed: ${containerData.error?.message ?? JSON.stringify(containerData)}`,
      }
    }

    const creationId = containerData.id

    // Step 2: Poll for container readiness (video processing takes 10-60s+)
    // 60s cap (was 120s) — a curated_video reel runs this AFTER a parallel render step that
    // itself can take up to 120s. Both steps share the 300s maxDuration of /api/agents/[slug]/run;
    // the old 240s+120s=360s combined worst case structurally exceeded it, guaranteeing an
    // orphaned 'publishing' row whenever both steps ran near their own caps (bug 2026-07-14).
    const ready = await this.waitForContainer(creationId, accessToken, 60_000, 5_000)
    if (!ready) {
      return { success: false, error: 'Reel processing timed out or failed after 60s' }
    }

    // Step 3: Publish the container
    const publishRes = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
    })

    const publishData = await publishRes.json()

    if (!publishRes.ok || !publishData.id) {
      return {
        success: false,
        error: `Reel publish failed: ${publishData.error?.message ?? JSON.stringify(publishData)}`,
      }
    }

    const permalink = await this.fetchPermalink(publishData.id, accessToken)

    return {
      success: true,
      postId: publishData.id,
      postUrl: permalink ?? undefined,
      qualityReview: qualityCheck.qualityReview,
    }
  }

  private async waitForContainer(id: string, accessToken: string, timeoutMs: number, intervalMs = 3000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      // Per-request timeout so a single stalled poll can't itself outlast the deadline check.
      const res = await fetch(`${GRAPH_API_BASE}/${id}?fields=status_code&access_token=${accessToken}`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => null)
      const data = res ? (await res.json().catch(() => ({}))) as { status_code?: string } : {}
      if (data.status_code === 'FINISHED') return true
      if (data.status_code === 'ERROR') return false
      await new Promise(r => setTimeout(r, intervalMs))
    }
    return false
  }

  private async fetchPermalink(mediaId: string, accessToken: string): Promise<string | null> {
    try {
      const res = await fetch(`${GRAPH_API_BASE}/${mediaId}?fields=permalink&access_token=${accessToken}`, {
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10_000),
      })
      const data = await res.json() as { permalink?: string }
      return data.permalink || null
    } catch {
      return null
    }
  }

  /**
   * Share to Stories (best effort). Uses cover image if available, otherwise skips.
   * Video Stories fail when > 60s, so cover image is more reliable.
   */
  async shareToStories(coverUrl?: string): Promise<string | null> {
    if (!coverUrl) return null
    const { igUserId, accessToken } = this.credentials
    try {
      const res = await fetch(`${GRAPH_API_BASE}/${igUserId}/media`, {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify({ media_type: 'STORIES', image_url: coverUrl, access_token: accessToken }),
        signal: AbortSignal.timeout(15_000),
      })
      const data = await res.json() as { id?: string; error?: { message: string } }
      if (!data.id) {
        console.error('[IG] Story container failed:', data.error?.message)
        return null
      }

      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000))
        const s = await fetch(`${GRAPH_API_BASE}/${data.id}?fields=status_code&access_token=${accessToken}`, {
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(10_000),
        })
        const sd = await s.json() as { status_code: string }
        if (sd.status_code === 'FINISHED') {
          const p = await fetch(`${GRAPH_API_BASE}/${igUserId}/media_publish`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: data.id, access_token: accessToken }),
            signal: AbortSignal.timeout(15_000),
          })
          return ((await p.json()) as { id?: string }).id || null
        }
        if (sd.status_code === 'ERROR') break
      }
    } catch { /* best effort */ }
    return null
  }

  /** Post a comment on a published media. Used to post hashtags as first comment (anti-shadowban). */
  async postComment(mediaId: string, text: string): Promise<void> {
    const { accessToken } = this.credentials
    try {
      await fetch(`${GRAPH_API_BASE}/${mediaId}/comments`, {
        method: 'POST',
        headers: this.jsonHeaders(),
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ message: text, access_token: accessToken }),
      })
    } catch { /* best effort */ }
  }

  // PlatformAdapter interface methods
  async publish(text: string): Promise<PublishResult> {
    return { success: false, error: 'Instagram requires an image. Use publishImage() or publishReel() instead.' }
  }

  async search(_options: SearchOptions): Promise<PlatformPost[]> {
    // Instagram Graph API doesn't have public search
    return []
  }

  async reply(_postId: string, _text: string): Promise<PublishResult> {
    return { success: false, error: 'Instagram reply not implemented' }
  }

  async like(_postId: string): Promise<boolean> {
    return false
  }
}
