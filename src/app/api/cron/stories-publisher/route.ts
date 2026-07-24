export const maxDuration = 200

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { INSTAGRAM_API_BASE } from '@/lib/config/constants'

// Video containers can poll for up to ~95s (30 attempts × 3s); leave buffer within maxDuration=200s.
const TIME_BUDGET_MS = 170_000
const VIDEO_WORST_CASE_MS = 100_000

/** Reels reposts share the curated video already published to the feed; image/carousel posts share the cover. */
export function buildStoryMediaPayload(item: { story_cover_url: string | null; story_video_url: string | null }): { video_url: string } | { image_url: string } | null {
  if (item.story_video_url) return { video_url: item.story_video_url }
  if (item.story_cover_url) return { image_url: item.story_cover_url }
  return null
}

/** Video containers take longer to reach FINISHED than image containers. */
export function getStoryPollParams(isVideo: boolean): { attempts: number; intervalMs: number } {
  return isVideo ? { attempts: 30, intervalMs: 3000 } : { attempts: 10, intervalMs: 2000 }
}

/**
 * Processes pending Instagram Stories scheduled after a feed post.
 * Anti-shadowban: stories are delayed 3–8 min after the feed post (zero-delay = bot pattern).
 * Items are scheduled by publisher/index.ts and reels-publish route via story_publish_after column.
 * Reels reposts use story_video_url (the same curated video published to the feed);
 * image/carousel posts use story_cover_url. Video containers take longer to process on IG,
 * so polling is longer for those.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()

  // Pick all items whose story delay has elapsed
  const { data: items } = await supabase
    .from('generated_content')
    .select('id, workspace_id, story_cover_url, story_video_url')
    .not('story_publish_after', 'is', null)
    .lte('story_publish_after', new Date().toISOString())
    .eq('status', 'published')
    .limit(5) // process up to 5 per run to stay within maxDuration

  if (!items?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_pending_stories' })
  }

  const results: Array<{ id: string; ok: boolean; error?: string }> = []
  const runStart = Date.now()

  for (const item of items) {
    // Bail before starting a new item if a video-worst-case poll wouldn't fit in the remaining budget
    if (Date.now() - runStart > TIME_BUDGET_MS - VIDEO_WORST_CASE_MS) {
      console.log('[stories-publisher] Time budget reached, remaining items retry next run')
      break
    }

    // Clear the schedule immediately to avoid double-processing on concurrent runs
    await supabase
      .from('generated_content')
      .update({ story_publish_after: null })
      .eq('id', item.id)

    const isVideo = !!item.story_video_url
    const mediaPayload = buildStoryMediaPayload(item)
    if (!mediaPayload) {
      results.push({ id: item.id, ok: false, error: 'no_cover_url' })
      continue
    }

    try {
      const { igUserId, accessToken: igToken } = await getInstagramCredentials(item.workspace_id)
      if (!igUserId || !igToken) {
        results.push({ id: item.id, ok: false, error: 'missing_credentials' })
        continue
      }

      const igApiBase = igToken.startsWith('IGAA')
        ? 'https://graph.instagram.com/v22.0'
        : INSTAGRAM_API_BASE

      // Create Stories container — video (reels repost) or image (feed/carousel repost)
      // Had no timeout at all before — caught by the outer try/catch if it hangs (AbortSignal
      // throws), so this doesn't crash the handler, but it DOES burn the item time-budget
      // check above, which only runs BETWEEN items — a single hung call still blocks the
      // whole run past its intended per-item budget.
      const storyRes = await fetch(`${igApiBase}/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'STORIES',
          ...mediaPayload,
          access_token: igToken,
        }),
        signal: AbortSignal.timeout(15_000),
      })
      const storyData = await storyRes.json() as { id?: string; error?: { message: string } }

      if (!storyData.id) {
        console.error(`[stories-publisher] Container failed for ${item.id}:`, storyData.error?.message)
        results.push({ id: item.id, ok: false, error: storyData.error?.message ?? 'container_failed' })
        continue
      }

      // Poll for container readiness. Video needs longer processing than image.
      const { attempts: pollAttempts, intervalMs: pollIntervalMs } = getStoryPollParams(isVideo)
      let published = false
      for (let i = 0; i < pollAttempts; i++) {
        await new Promise(r => setTimeout(r, pollIntervalMs))
        const ss = await fetch(`${igApiBase}/${storyData.id}?fields=status_code&access_token=${igToken}`, {
          signal: AbortSignal.timeout(10_000),
        })
        const sd = await ss.json() as { status_code?: string }
        if (sd.status_code === 'FINISHED') {
          const sp = await fetch(`${igApiBase}/${igUserId}/media_publish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creation_id: storyData.id, access_token: igToken }),
            signal: AbortSignal.timeout(15_000),
          })
          const spData = await sp.json() as { id?: string }
          published = !!spData.id
          break
        }
        if (sd.status_code === 'ERROR') break
      }

      results.push({ id: item.id, ok: published })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      results.push({ id: item.id, ok: false, error: msg })
    }
  }

  const ok = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`[stories-publisher] published=${ok} failed=${failed}`)
  return NextResponse.json({ ok: true, published: ok, failed, results })
}
