import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { getAdminClient } from '@/lib/supabase/admin'
import { XClient } from '@/lib/platforms/x/client'
import { LinkedInClient } from '@/lib/platforms/linkedin/client'
import { InstagramClient, splitHashtags, applyMicroVariation } from '@/lib/platforms/instagram/client'
import { getPlatformConfig, getActivePlatforms } from '@/lib/settings/platform-config'
import { getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { getInstagramCredentials, getLinkedInCredentials, getYouTubeCredentials, checkCredentialHealth } from '@/lib/settings/load-credentials'
import { YouTubeClient } from '@/lib/platforms/youtube/client'
import { getPublishableContentText, runQualityGate } from '@/lib/eval/quality-gate'
import { getBaseUrl } from '@/lib/api/base-url'
import type { PublishResult } from '@/lib/platforms/platform-adapter'
import { generateStoredImage } from '@/lib/ai/openai-image'
import { parseAIJson } from '@/lib/ai/parse-json'
import { generateTextWithFallback } from '@/lib/ai/generate-with-fallback'
import { trimVideoForXIfNeeded } from '@/lib/video/trim-video-for-x'
import { isWorkspaceFeatureEnabled } from '@/lib/config/workspace-features'

// Fallback defaults; overridden at runtime by settings system
const DEFAULT_MAX_POSTS_PER_RUN = 5

/**
 * Bounds an AWS SDK call (Remotion Lambda) that has no built-in client-side timeout.
 * Without this, a single hung API call (kickoff or poll) can block indefinitely — the
 * outer `while (Date.now() - start < maxWait)` deadline in renderWithRemotion only checks
 * BETWEEN calls, so an individual stalled call isn't bounded by it at all.
 */
function promiseWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

/**
 * Marca o item como 'failed' (esgotou tentativas / exceção permanente) ou devolve pra
 * 'approved' (ainda tem tentativa) depois de uma EXCEÇÃO no publish (não um result.success=false
 * normal — esse caminho já era tratado com await). Extraído do catch() do execute() pra poder
 * ser testado isoladamente.
 *
 * Achado real 23/07/2026: a versão anterior disparava o update SEM await, com
 * `.then(() => {}, () => {})` — engolindo sucesso E erro. Se o processo terminasse antes do
 * update resolver (ex.: a função da Vercel encerra logo depois do catch, sem esperar promises
 * soltas) ou o update falhasse por qualquer motivo, o item ficava preso em 'publishing' pra
 * sempre — sem retry, sem log, sem sinal nenhum (achado ao investigar por que o Doctor não
 * conseguia fechar um caso `ai_br_videos:failed` real).
 */
export async function finalizeExceptionRetry(
  supabase: ReturnType<typeof getAdminClient>,
  itemId: string,
  retryCount: number,
  maxRetries: number,
  isPermanentException: boolean,
  msg: string
): Promise<void> {
  const isFinal = retryCount >= maxRetries || isPermanentException
  const patch = isFinal
    ? { status: 'failed' as const, retry_count: retryCount, review_feedback: `Failed after ${retryCount} attempts (exception): ${msg}` }
    : { status: 'approved' as const, retry_count: retryCount }
  const { error } = await supabase
    .from('generated_content')
    .update(patch)
    .eq('id', itemId)
    .eq('status', 'publishing')
  if (error) {
    console.error(`[publisher] Falha ao atualizar item ${itemId} após exceção (destino: ${patch.status}): ${error.message}`)
  }
}

/**
 * Unstick items stuck in 'publishing' for >10 min (Vercel maxDuration kills the function
 * mid-flight — e.g. Remotion Lambda render + Instagram container polling can together
 * exceed the 300s budget — leaving the DB row orphaned in 'publishing').
 *
 * Historically only ran at the start of this agent's own execute(), so recovery was
 * gated on the agent's schedule_cron (as infrequent as 3x/day for Brand — up to ~16h
 * to notice a stuck item). Also called from the scheduler cron (every 5 min, all
 * workspaces) so recovery no longer depends on how often this specific agent runs.
 */
export async function unstickPublishingItems(
  supabase: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  retryAttempts: number,
): Promise<{ unstuck: number; retried: number; failed: number }> {
  const stuckCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: stuckItems } = await supabase
    .from('generated_content')
    .select('id, retry_count')
    .eq('workspace_id', workspaceId)
    .eq('status', 'publishing')
    .lt('updated_at', stuckCutoff)

  if (!stuckItems?.length) return { unstuck: 0, retried: 0, failed: 0 }

  const maxRetries = retryAttempts || 3
  const toFail = stuckItems.filter(i => ((i.retry_count ?? 0) + 1) >= maxRetries).map(i => i.id)
  const toRetry = stuckItems.filter(i => ((i.retry_count ?? 0) + 1) < maxRetries).map(i => i.id)

  if (toFail.length) {
    await supabase.from('generated_content').update({ status: 'failed', review_feedback: 'Timeout: stuck in publishing state' }).in('id', toFail)
  }
  if (toRetry.length) {
    for (const stuck of stuckItems.filter(i => toRetry.includes(i.id))) {
      await supabase.from('generated_content').update({ status: 'approved', retry_count: (stuck.retry_count ?? 0) + 1 }).eq('id', stuck.id)
    }
  }
  return { unstuck: stuckItems.length, retried: toRetry.length, failed: toFail.length }
}

/** Remove stock cashtags ($TICKER) from X content */
function sanitizeXCashtags(text: string): string {
  return text.replace(/\$[A-Z]{1,6}\b/g, '').replace(/\s{2,}/g, ' ').trim()
}

/** No-op passthrough — preserved for symmetric call signature */
function sanitizeXExternalLinks(text: string): string {
  return text
}

// ── Anti-shadowban: CTA throttle ────────────────────────────────────────────
// "Comenta X" is a comment-baiting CTA. Max 2 per 3-day window — more = spam flag.
// "comenta X" only when used as imperative CTA: at start, after newline, or after sentence punctuation.
// Avoids false positives like "A imprensa comenta sobre..." (verb in mid-sentence).
const COMMENT_CTA_REGEX = /(^|\n|[.!?]\s+)comenta\s+\w+/i

function hasCommentCta(caption: string): boolean {
  return COMMENT_CTA_REGEX.test(caption)
}

function stripCommentCta(caption: string): string {
  return caption.replace(/(^|\n|[.!?]\s+)comenta\s+\w+[^\n]*/gi, '$1').replace(/\n{3,}/g, '\n\n').trim()
}

async function isCommentCtaThrottled(workspaceId: string): Promise<boolean> {
  const supabase = getAdminClient()
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('generated_content')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('status', 'published')
    .ilike('content', '%comenta %')
    .gte('published_at', threeDaysAgo)
  return (count ?? 0) >= 2
}

const PLATFORM_ICONS: Record<string, string> = {
  x: '\u{1F426}',        // bird
  linkedin: '\u{1F4BC}', // briefcase
  instagram: '\u{1F4F8}', // camera with flash
}

interface PublishEntry {
  content: string
  platform: string
  status: 'published' | 'rejected' | 'error'
  url?: string
  reason?: string
}

/**
 * Parse an SRT subtitle file into the frame-based format expected by the Railway renderer.
 */
function parseSrtToFrames(srt: string, fps = 30): Array<{ text: string; startFrame: number; endFrame: number }> {
  const blocks = srt.trim().split(/\n\n+/)
  const subtitles: Array<{ text: string; startFrame: number; endFrame: number }> = []
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    const timeLine = lines[1]
    const textLines = lines.slice(2).join(' ')
    const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
    if (!match) continue
    const toMs = (h: string, m: string, s: string, ms: string) =>
      (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s)) * 1000 + parseInt(ms)
    const startMs = toMs(match[1], match[2], match[3], match[4])
    const endMs = toMs(match[5], match[6], match[7], match[8])
    subtitles.push({
      text: textLines.trim(),
      startFrame: Math.round(startMs * fps / 1000),
      endFrame: Math.round(endMs * fps / 1000),
    })
  }
  return subtitles
}

/**
 * Transcribe a video URL via Railway, translate to PT-BR, and burn karaoke subtitles.
 * Returns the rendered video URL, or null if no speech detected or on any failure.
 * Non-fatal: caller always falls back to the original video URL.
 */
export async function burnSubtitlesForX(videoUrl: string): Promise<string | null> {
  const REEL_RENDERER_URL = process.env.REEL_RENDERER_URL || ''
  const REEL_RENDERER_API_KEY = process.env.REEL_RENDERER_API_KEY || ''

  if (!REEL_RENDERER_URL || !REEL_RENDERER_API_KEY) return null

  // Step 1: Transcribe
  let srtText = ''
  try {
    const trRes = await fetch(`${REEL_RENDERER_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
      body: JSON.stringify({ video_url: videoUrl }),
      signal: AbortSignal.timeout(45_000),
    })
    if (trRes.ok) {
      const tr = await trRes.json() as { srt?: string; text?: string }
      if (tr.text && tr.text.length > 10 && !/^[♪\s]+$/.test(tr.text)) {
        srtText = tr.srt || ''
      }
    }
  } catch (err) {
    console.error('[publisher] burnSubtitles: transcribe error:', err instanceof Error ? err.message : err)
    return null
  }

  if (!srtText) return null // no speech — use original video as-is

  // Step 2: Translate SRT to PT-BR via generateTextWithFallback (Claude primary,
  // Gemini fallback, OpenRouter tier-0 when configured) — Cláusula Pétrea #9:
  // nunca fetch direto à API Anthropic num fluxo disparado por cron. Bounded
  // to the same 20s budget via promiseWithTimeout so the combined
  // 45+20+200=265s pipeline budget is unaffected by the shared function's own
  // retry/fallback cascade potentially taking longer than this step's slot.
  let srtPtbr = srtText
  try {
    const translated = await promiseWithTimeout(
      generateTextWithFallback({
        system: 'Translate this SRT subtitle file to Brazilian Portuguese (PT-BR). Keep all timestamps exactly as-is. Only translate the text lines. Return ONLY the translated SRT, no explanation.',
        prompt: srtText,
        maxOutputTokens: 2000,
      }),
      20_000,
      'SRT translation',
    )
    if (translated) srtPtbr = translated
  } catch (err) {
    console.warn('[publisher] burnSubtitles: SRT translation failed, using original language:', err instanceof Error ? err.message : err)
  }

  // Step 3: Parse SRT → frame-based subtitle array
  const subtitles = parseSrtToFrames(srtPtbr, 30)
  if (!subtitles.length) return null

  // Step 4: Burn subtitles via Railway /render/full (subtitle-only mode — no hook overlay)
  try {
    const renderRes = await fetch(`${REEL_RENDERER_URL}/render/full`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
      body: JSON.stringify({ videoUrl, subtitles }),
      signal: AbortSignal.timeout(200_000), // 200s: 45+20+200=265s total budget, leaves ~35s for publisher overhead within 300s maxDuration
    })
    if (renderRes.ok) {
      const result = await renderRes.json() as { videoUrl?: string }
      if (result.videoUrl) {
        console.log(`[publisher] burnSubtitles: subtitles burned, rendered URL: ${result.videoUrl}`)
        return result.videoUrl
      }
    } else {
      console.error(`[publisher] burnSubtitles: render/full failed: ${renderRes.status}`)
    }
  } catch (err) {
    console.error('[publisher] burnSubtitles: render error:', err instanceof Error ? err.message : err)
  }

  return null
}

/**
 * Get media URLs from curated content.
 */
async function getSourceMedia(curatedContentId: string): Promise<{ imageUrl: string | null; videoUrl: string | null; allImageUrls: string[] }> {
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('curated_content')
    .select('source_metrics')
    .eq('id', curatedContentId)
    .single()
  const metrics = data?.source_metrics as Record<string, unknown> | null
  const mediaUrls = metrics?.media_urls as string[] | null
  const videoUrl = metrics?.video_url as string | null
  return {
    imageUrl: mediaUrls?.[0] || null,
    videoUrl: videoUrl || null,
    allImageUrls: mediaUrls ?? [],
  }
}

/**
 * Publish an Instagram Reel. Handles two types:
 *
 * 1. CURATED VIDEO — Video from X/Twitter with PT-BR subtitles (Remotion Lambda)
 *    Content JSON: { format: "reel", type: "curated_video", original_video_url, subtitles, hookTitle, highlightName, caption }
 *
 * 2. SLIDESHOW — AI-generated slides (Remotion Lambda)
 *    Content JSON: { format: "reel", slides: [...], caption, image_prompts: [...] }
 */
async function publishInstagramReel(
  igClient: InstagramClient,
  item: { id: string; content: string; curated_content_id: string | null },
  workspaceId: string,
): Promise<PublishResult> {
  try {
    let reelData: any
    try {
      reelData = parseAIJson(item.content)
    } catch {
      return { success: false, error: 'Reel content is not valid JSON' }
    }

    const rawCaption = reelData.caption || item.content.slice(0, 2200)
    const { cleanCaption, hashtags } = splitHashtags(rawCaption)

    // CTA throttle: max 2 comment-CTAs per 3-day window
    let caption = cleanCaption
    if (hasCommentCta(cleanCaption) && await isCommentCtaThrottled(workspaceId)) {
      caption = stripCommentCta(cleanCaption)
      console.warn('[publisher] Comment CTA throttled — stripped from reel caption')
    }
    // B1: ~20% micro-variation to avoid repetitive caption structure fingerprint
    caption = applyMicroVariation(caption)
    const altText = caption.split('\n')[0].replace(/[#@]/g, '').trim().slice(0, 100)
    const supabase = getAdminClient()

    const instagramHandle = await getVariable(workspaceId, 'instagram_handle')
    const maxRendersPerDay = await getNumericVariable(workspaceId, 'max_renders_per_day')

    // ── TYPE 1: Curated video (from X/Twitter) — render with Remotion ──
    if (reelData.type === 'curated_video' && reelData.original_video_url) {
      // Run Remotion render + cover generation in parallel — saves ~160s vs sequential
      const useWorkspaceReelCover = await isWorkspaceFeatureEnabled(workspaceId, 'video_reels')

      const coverPromise: Promise<string | null> = useWorkspaceReelCover && reelData.image_prompt
        ? import('@/lib/ai/generate-brand-reel-cover').then(({ generatebrandReelCover }) =>
            generatebrandReelCover({
              hookTitle:     reelData.hookTitle    || '',
              highlightName: reelData.highlightName || '',
              imagePrompt:   reelData.image_prompt,
              itemId:        item.id,
              kpi:           reelData.kpi,
            })
          )
        : generateReelCover(
            reelData.hookTitle    || '',
            reelData.highlightName || '',
            undefined,
            instagramHandle,
          )

      const [videoUrl, coverUrl] = await Promise.all([
        renderWithRemotion('CuratedVideoReel', {
          videoUrl:      reelData.original_video_url,
          hookTitle:     reelData.hookTitle    || '',
          highlightName: reelData.highlightName || '',
          handle:        instagramHandle,
          subtitles:     reelData.subtitles    || [],
        }, maxRendersPerDay),
        coverPromise,
      ])

      const publishVideoUrl = videoUrl ?? reelData.original_video_url
      if (!videoUrl) {
        console.warn('[publisher] Remotion render failed, publishing original video')
      }

      const result = await igClient.publishReel(caption, publishVideoUrl, coverUrl || undefined, altText)
      if (result.success) {
        // B2: 12% of posts skip hashtag comment (pattern variation against bot detection)
        if (hashtags && result.postId && Math.random() >= 0.12) igClient.postComment(result.postId, hashtags).catch(() => {})
        if (coverUrl && result.postId) {
          queueStoryUpdate(supabase, item.id, coverUrl)
        }
      }
      return result
    }

    // ── TYPE 2: Slideshow — render with Remotion ──
    if (reelData.slides?.length) {
      // Generate images for slides in PARALLEL (was sequential) — this step runs BEFORE
      // Remotion + Instagram publish, entirely inside the same 300s maxDuration, so its
      // total time is additive rather than overlapping like the CuratedVideoReel path.
      // Sequential generation scaled with slide count (N × up to 90s each); parallel
      // generation is bounded by the single slowest call regardless of N.
      await Promise.all(reelData.slides.map(async (slide: { imageUrl?: string }, i: number) => {
        if (!slide.imageUrl && reelData.image_prompts?.[i]) {
          slide.imageUrl = await generateSlideImage(reelData.image_prompts[i])
        }
      }))

      // Lighter maxWaitMs than the CuratedVideoReel default (90s) — a slideshow composition
      // is static images + text overlays, no video transcoding, and this step is fully
      // sequential after slide generation (not parallel with it), so it must leave more
      // headroom for the sequential Instagram publish step that follows.
      const videoUrl = await renderWithRemotion('SlideshowReel', {
        slides: reelData.slides,
        showIntro: true,
        showOutro: true,
      }, maxRendersPerDay, 45_000)

      if (!videoUrl) {
        return { success: false, error: 'Remotion slideshow render failed' }
      }

      const slideshowCoverUrl = reelData.slides.find((slide: { imageUrl?: string }) => slide.imageUrl)?.imageUrl
      const result = await igClient.publishReel(caption, videoUrl, slideshowCoverUrl, altText)
      if (result.success) {
        // B2: 12% of posts skip hashtag comment (pattern variation against bot detection)
        if (hashtags && result.postId && Math.random() >= 0.12) igClient.postComment(result.postId, hashtags).catch(() => {})
        // No cover for slideshow — skip story scheduling
      }
      return result
    }

    // ── TYPE 3: Pre-rendered video (videoUrl already in storage) ──
    // Written by the reel pipeline when video is downloaded/rendered externally
    // and stored in Supabase before the publisher runs.
    if (reelData.videoUrl) {
      const coverUrl = await generateReelCover(
        reelData.hookTitle || '',
        reelData.highlightWords?.[0] || '',
        undefined,
        instagramHandle,
      )
      const result = await igClient.publishReel(caption, reelData.videoUrl, coverUrl || undefined, altText)
      if (result.success) {
        // B2: 12% of posts skip hashtag comment (pattern variation against bot detection)
        if (hashtags && result.postId && Math.random() >= 0.12) igClient.postComment(result.postId, hashtags).catch(() => {})
        if (coverUrl && result.postId) {
          queueStoryUpdate(supabase, item.id, coverUrl)
        }
      }
      return result
    }

    return { success: false, error: 'Reel data has no video_url or slides' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Reel pipeline error: ${msg}` }
  }
}

// Daily render counter (Q35 — budget cap)
let renderCountToday = 0
let renderCountDate = ''
const DEFAULT_MAX_RENDERS_PER_DAY = 15

/**
 * Render a video using Remotion Lambda on AWS.
 * Returns the public S3 URL of the rendered MP4, or null on failure.
 */
async function renderWithRemotion(composition: string, inputProps: Record<string, unknown>, maxRendersPerDay: number = DEFAULT_MAX_RENDERS_PER_DAY, maxWaitMs = 90_000): Promise<string | null> {
  // Budget cap check (Q35)
  const today = new Date().toISOString().slice(0, 10)
  if (renderCountDate !== today) {
    renderCountDate = today
    renderCountToday = 0
  }
  if (renderCountToday >= maxRendersPerDay) {
    console.error(`[publisher] Remotion budget cap reached: ${renderCountToday}/${maxRendersPerDay} renders today`)
    return null
  }
  renderCountToday++

  const REGION = process.env.REMOTION_REGION || 'us-east-1'
  const FUNCTION = process.env.REMOTION_FUNCTION || ''
  const SERVE_URL = process.env.REMOTION_SERVE_URL || ''

  if (!FUNCTION || !SERVE_URL) {
    console.error('[publisher] REMOTION_FUNCTION or REMOTION_SERVE_URL not configured')
    return null
  }

  try {
    // Dynamic import to avoid bundling issues
    const { renderMediaOnLambda, getRenderProgress } = await import('@remotion/lambda/client')

    // Kickoff call had no timeout at all — a hung AWS API call would block indefinitely,
    // uncovered by the polling deadline below (which only checks BETWEEN calls).
    const { renderId, bucketName } = await promiseWithTimeout(renderMediaOnLambda({
      region: REGION as any,
      functionName: FUNCTION,
      serveUrl: SERVE_URL,
      composition,
      inputProps,
      codec: 'h264',
      maxRetries: 1,
      privacy: 'public',
      framesPerLambda: 800,
    }), 15_000, 'renderMediaOnLambda kickoff')

    console.log(`[publisher] Remotion render started: ${renderId}`)

    // Poll for completion (default 90s, was 240s — reduced 2026-07-15).
    // This step runs in parallel with cover generation, then is followed by sequential
    // Instagram container creation + poll (up to 60s) + publish, all inside the same
    // 300s maxDuration of /api/agents/[slug]/run. The old 240s cap left too little room
    // for the IG steps — combined worst case (240s + 120s IG poll = 360s) structurally
    // exceeded the function budget, guaranteeing an orphaned 'publishing' row whenever
    // both steps ran near their own caps (bug 2026-07-14, @brand stuck >24h).
    // Callers with a lighter render (e.g. SlideshowReel — no video transcoding) should
    // pass a smaller maxWaitMs since their own upstream step (slide image generation)
    // already consumes part of the shared 300s budget sequentially, not in parallel.
    const maxWait = maxWaitMs
    const start = Date.now()
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 5000))

      // Per-poll timeout (10s) so a single stalled request can't itself outlast the deadline.
      const progress = await promiseWithTimeout(getRenderProgress({
        renderId,
        bucketName,
        region: REGION as any,
        functionName: FUNCTION,
      }), 10_000, 'getRenderProgress poll').catch(() => ({ done: false, fatalErrorEncountered: false, outputFile: null, errors: [] }) as any)

      if (progress.done) {
        console.log(`[publisher] Remotion render complete: ${progress.outputFile}`)
        return progress.outputFile as string
      }

      if (progress.fatalErrorEncountered) {
        console.error(`[publisher] Remotion render failed:`, progress.errors?.[0]?.message)
        return null
      }
    }

    console.error('[publisher] Remotion render timed out')
    return null
  } catch (err) {
    console.error('[publisher] Remotion error:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Generate a cover image for an Instagram Reel.
 *
 * 1. Generate photorealistic background via OpenAI Images
 * 2. Render final cover with Remotion Lambda (CoverImage composition)
 *    — Doomguy logo, Impact font title, purple highlights
 */
async function generateReelCover(
  hookTitle: string,
  highlightName: string,
  topic?: string,
  handle?: string,
): Promise<string | null> {
  const RENDER_API_URL = process.env.REEL_RENDERER_URL || ''
  const RENDER_API_KEY = process.env.REEL_RENDERER_API_KEY || ''
  if (!RENDER_API_URL || !RENDER_API_KEY) return null

  try {
    // Step 1: Generate background image via Railway renderer
    console.log('[publisher] Generating AI background for cover...')
    const bgRes = await fetch(`${RENDER_API_URL}/cover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${RENDER_API_KEY}`,
      },
      body: JSON.stringify({
        hookTitle,
        highlightName,
        handle: handle || '@inteligencia.artificial.brazil',
        topic: topic || hookTitle,
      }),
      // Had no timeout at all before — a hung Railway call could block indefinitely,
      // eating into the 300s maxDuration budget shared with the Remotion render + IG publish.
      signal: AbortSignal.timeout(30_000),
    })
    const bgData = bgRes.ok ? await bgRes.json() as { url?: string } : null
    const backgroundUrl = bgData?.url || null
    if (!backgroundUrl) {
      console.warn('[publisher] Cover background generation failed, skipping cover')
      return null
    }

    // Step 2: Render cover with Remotion Lambda (CoverImage composition)
    console.log('[publisher] Rendering cover with Remotion...')
    const highlightWords = highlightName
      .split(' ')
      .filter((w: string) => w.length > 1)

    const { renderStillOnLambda } = await import('@remotion/lambda/client')

    const REGION = process.env.REMOTION_REGION || 'us-east-1'
    const FUNCTION = process.env.REMOTION_FUNCTION || ''
    const SERVE_URL = process.env.REMOTION_SERVE_URL || ''

    if (!FUNCTION || !SERVE_URL) {
      console.warn('[publisher] Remotion not configured, using cover directly')
      return backgroundUrl
    }

    // Had no timeout at all before — a still-image render is normally fast, but an
    // unbounded AWS call can still hang the whole function past its 300s maxDuration.
    const result = await promiseWithTimeout(renderStillOnLambda({
      region: REGION as any,
      functionName: FUNCTION,
      serveUrl: SERVE_URL,
      composition: 'CoverImage',
      inputProps: {
        backgroundUrl,
        title: hookTitle,
        highlightWords,
        subtitle: '',
        handle: handle || '@inteligencia.artificial.brazil',
      },
      imageFormat: 'jpeg',
      privacy: 'public',
    }), 45_000, 'renderStillOnLambda')

    console.log('[publisher] Cover rendered:', result.url)
    return result.url
  } catch (err) {
    console.warn('[publisher] Cover generation error:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Generate a slide background image using AI.
 * Uses OpenAI Images and falls back to a generated placeholder.
 */
async function generateSlideImage(prompt: string): Promise<string> {
  const imageUrl = await generateStoredImage({
    prompt: `${prompt}, vertical 9:16 aspect ratio, 1080x1920, high quality, cinematic, photorealistic, no text`,
    path: `slides/${Date.now()}-${Math.random().toString(36).slice(2)}.png`,
    size: '1024x1536',
  })

  if (imageUrl) return imageUrl

  const baseUrl = getBaseUrl()
  return `${baseUrl}/api/og?text=${encodeURIComponent(prompt.slice(0, 100))}`
}

class PublisherAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'publisher',
      name: 'Publicador',
      role: 'publisher',
      description: 'Publica conteúdo aprovado nas redes sociais',
      defaultModel: 'deepseek-chat', // fallback; overridden by settings via agent-runner
      pipelineStage: 5,
      maxActionsPerHour: 20, // fallback; overridden by settings via agent-runner
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    const entries: PublishEntry[] = []
    const errors: string[] = []

    const settingsMaxPosts = await getNumericVariable(ctx.workspaceId, 'publisher_max_posts_per_run')
    const MAX_POSTS_PER_RUN = Number(ctx.settings?.max_posts_per_run ?? (settingsMaxPosts || DEFAULT_MAX_POSTS_PER_RUN))
    const retryAttempts = await getNumericVariable(ctx.workspaceId, 'publisher_retry_attempts')

    // 1. Load active platforms — only publish to platforms that are enabled
    const activePlatforms = await getActivePlatforms(ctx.workspaceId)
    if (!activePlatforms.length) {
      return {
        success: true,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { entries: [], reason: 'no_active_platforms' },
      }
    }

    // 1a. Credential health check — detect misconfigured workspaces before touching any content.
    // Prevents cross-workspace contamination: a platform active in DB but with no credentials
    // must never fall back to another workspace's env vars.
    const credIssues = await checkCredentialHealth(ctx.workspaceId, activePlatforms)
    if (credIssues.length) {
      const warnings = credIssues.map(({ platform, missing }) =>
        `${platform}: missing DB credentials [${missing.join(', ')}] — platform skipped`
      )
      warnings.forEach(w => console.warn(`[publisher][workspace:${ctx.workspaceId}] ${w}`))
      // Remove platforms with missing credentials from the publish queue
      const misconfigured = new Set(credIssues.map(i => i.platform))
      activePlatforms.splice(0, activePlatforms.length, ...activePlatforms.filter(p => !misconfigured.has(p)))
      if (!activePlatforms.length) {
        return {
          success: false,
          itemsProcessed: 0,
          itemsProduced: 0,
          errors: warnings,
          tokensUsed: 0,
          costEstimate: 0,
          durationMs: Date.now() - startTime,
          details: { entries: [], reason: 'missing_credentials' },
        }
      }
    }

    // 1b. Unstick items stuck in 'publishing' for >10 min (Vercel timeout leaves them orphaned)
    const unstuckResult = await unstickPublishingItems(supabase, ctx.workspaceId, retryAttempts || 3)
    if (unstuckResult.unstuck) {
      console.log(`[publisher] Unstuck ${unstuckResult.unstuck} orphaned items (${unstuckResult.retried} retried, ${unstuckResult.failed} failed)`)
    }

    // 2. Load approved content — filtered to active platforms, wider pool to sort by relevance
    const RELEVANCE_RANK: Record<string, number> = { alta: 3, media: 2, baixa: 1 }
    const maxContentAgeHours = Number(ctx.settings?.curator_max_tweet_age_hours ?? 72)
    const { data: rawContent } = await supabase
      .from('generated_content')
      .select('id, target_platform, target_format, content, curated_content_id, retry_count, review_score, metadata, curated_content:curated_content_id(source_url, created_at, topic:topic_id(relevance))')
      .eq('workspace_id', ctx.workspaceId)
      .eq('status', 'approved')
      .in('target_platform', activePlatforms)
      .order('created_at', { ascending: true }) // oldest first — FIFO within same priority tier
      .limit(100) // large pool — prevents starvation regardless of max_posts_per_run

    // Freshness gate: reject approved content whose source is older than maxContentAgeHours.
    // This prevents publishing stale news that was curated/written days ago.
    const ageCutoff = new Date(Date.now() - maxContentAgeHours * 60 * 60 * 1000)
    const staleIds: string[] = []
    const freshContent = (rawContent ?? []).filter(item => {
      const cc = item.curated_content as { source_url?: string; created_at?: string; topic?: { relevance?: string } } | null
      if (!cc?.created_at) return true // no curated source = keep (AI-generated content)
      if (item.target_format === 'reel') return true // reel video stored in Supabase — no expiry concern
      if (new Date(cc.created_at) >= ageCutoff) return true
      staleIds.push(item.id)
      return false
    })
    if (staleIds.length > 0) {
      // Achado real 23/07/2026 (mesma classe do bug em finalizeExceptionRetry): sem await, se
      // esse update falhar ou o processo terminar antes de resolver, os itens obsoletos
      // continuam elegíveis e podem ser publicados depois como se fossem notícia fresca.
      const { error: staleRejectErr } = await supabase.from('generated_content')
        .update({ status: 'rejected', review_feedback: `Conteudo fonte mais velho que ${maxContentAgeHours}h — descartado para evitar publicar noticias velhas` })
        .in('id', staleIds)
      if (staleRejectErr) {
        console.error(`[publisher] Falha ao rejeitar ${staleIds.length} item(ns) obsoleto(s): ${staleRejectErr.message}`)
      } else {
        console.log(`[publisher] Rejected ${staleIds.length} stale items (source older than ${maxContentAgeHours}h)`)
      }
    }

    // A/B deduplication: when variants A and B are both approved for the same
    // curated_content_id + platform, only keep the one with the higher review_score.
    // Mark the loser as rejected so it doesn't get published in a future run.
    type ContentRow = NonNullable<typeof rawContent>[number]
    const abGroups = new Map<string, ContentRow[]>()
    for (const item of freshContent) {
      const key = `${item.curated_content_id}::${item.target_platform}`
      if (!abGroups.has(key)) abGroups.set(key, [])
      abGroups.get(key)!.push(item)
    }
    const losersToReject: string[] = []
    const deduped: ContentRow[] = []
    for (const group of abGroups.values()) {
      if (group.length === 1) { deduped.push(group[0]); continue }
      group.sort((a, b) => ((b.review_score as number) ?? 0) - ((a.review_score as number) ?? 0))
      deduped.push(group[0])
      for (const loser of group.slice(1)) losersToReject.push(loser.id)
    }
    if (losersToReject.length > 0) {
      // Sem await, uma variante perdedora não-rejeitada a tempo pode ser publicada numa run
      // futura ao lado da vencedora — duplicata visível de A/B no mesmo canal.
      const { error: abRejectErr } = await supabase.from('generated_content')
        .update({ status: 'rejected', review_feedback: 'Superseded by higher-scoring A/B variant' })
        .in('id', losersToReject)
      if (abRejectErr) {
        console.error(`[publisher] Falha ao rejeitar ${losersToReject.length} variante(s) A/B perdedora(s): ${abRejectErr.message}`)
      }
    }

    // Check if a reel was already published today (to decide whether to prioritize reels)
    const todayIso = new Date().toISOString().slice(0, 10)
    const { count: reelsTodayCount } = await supabase
      .from('generated_content')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ctx.workspaceId)
      .eq('target_format', 'reel')
      .eq('status', 'published')
      .gte('created_at', `${todayIso}T00:00:00.000Z`)
    const reelPublishedToday = (reelsTodayCount ?? 0) > 0

    // Sort: breaking news first, then reels if none published today, then alta/media/baixa relevance
    const content = deduped.sort((a, b) => {
      const aBreaking = !!(a.metadata as Record<string, unknown> | null)?.breaking_news ? 1 : 0
      const bBreaking = !!(b.metadata as Record<string, unknown> | null)?.breaking_news ? 1 : 0
      if (bBreaking !== aBreaking) return bBreaking - aBreaking
      // Guarantee at least 1 reel per day — push it to front if none published yet
      if (!reelPublishedToday) {
        const aReel = a.target_format === 'reel' ? 1 : 0
        const bReel = b.target_format === 'reel' ? 1 : 0
        if (bReel !== aReel) return bReel - aReel
      }
      const cc = (x: typeof a) => (x.curated_content as { topic?: { relevance?: string } } | null)
      const ra = RELEVANCE_RANK[(cc(a)?.topic?.relevance ?? 'baixa')] ?? 1
      const rb = RELEVANCE_RANK[(cc(b)?.topic?.relevance ?? 'baixa')] ?? 1
      return rb - ra
    }).slice(0, MAX_POSTS_PER_RUN)

    if (!content?.length) {
      return {
        success: true,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { entries: [], reason: 'no_approved_content' },
      }
    }

    for (const item of content) {
      const platform = item.target_platform ?? 'x'
      try {
        // 2. Run quality gate (platform-aware)
        const platformConfig = await getPlatformConfig(ctx.workspaceId, platform)
        const qg = runQualityGate(item.content, platform, platformConfig ?? undefined)
        if (!qg.passed) {
          const reason = qg.issues.join('; ')
          await supabase
            .from('generated_content')
            .update({
              status: 'rejected',
              review_score: qg.score,
              review_feedback: reason,
              review_issues: qg.issues,
            })
            .eq('id', item.id)
          entries.push({ content: item.content, platform, status: 'rejected', reason })
          continue
        }

        // 3. Platform-specific length check via platform config (reuses platformConfig from above)
        // Measures the extracted caption (what actually gets published), not the raw
        // content field — for structured Brand JSON, item.content also includes
        // headline/context/kpi/image_prompt, which inflates the count well past what
        // Instagram actually displays.
        const maxLength = platformConfig?.maxLength ?? (platform === 'x' ? 280 : 3000)
        const publishableLength = getPublishableContentText(item.content).length
        if (publishableLength > maxLength) {
          const reason = `excede ${maxLength} caracteres (${publishableLength}) para ${platform}`
          await supabase
            .from('generated_content')
            .update({
              status: 'rejected',
              review_feedback: reason,
              review_issues: [reason],
            })
            .eq('id', item.id)
          entries.push({ content: item.content, platform, status: 'rejected', reason })
          continue
        }

        // 4. Claim the item atomically before posting — prevents double-posting when
        //    two publisher instances run concurrently (scheduler race condition).
        const { data: claimed, error: claimError } = await supabase
          .from('generated_content')
          .update({ status: 'publishing' })
          .eq('id', item.id)
          .eq('status', 'approved') // only succeeds if still unclaimed
          .select('id')
        if (claimError) {
          console.error(`[publisher] Claim error for ${item.id}: ${claimError.message} (code: ${claimError.code})`)
          errors.push(`Claim failed: ${claimError.message}`)
          entries.push({ content: item.content, platform, status: 'error', reason: `claim_error: ${claimError.message}` })
          continue
        }
        if (!claimed?.length) {
          console.log(`[publisher] Claim skipped for ${item.id}: already owned by another instance (status no longer 'approved')`)
          continue // another instance already owns this item
        }

        // 5. Dry run — skip actual posting
        if (ctx.dryRun) {
          console.log(`[publisher][dry-run][${platform}] Would publish: "${item.content.slice(0, 80)}..."`)
          entries.push({ content: item.content, platform, status: 'published', url: 'dry_run' })
          continue
        }

        // 5. Route to the correct platform client
        let result: PublishResult

        switch (platform) {
          case 'x': {
            const xClient = XClient.fromEnv()

            // Detect thread format: content is a JSON array of tweets.
            // Normalize curly/typographic quotes to ASCII before parsing — the writer
            // occasionally outputs "smart quotes" that silently break JSON.parse.
            let threadTweets: string[] | null = null
            // Matches ["  or [' or [" or [' — a JSON array of strings (possibly with curly quotes)
            const looksLikeArray = /^\s*\[[\s]*["\u201C\u2018']/.test(item.content)
            try {
              const normalized = item.content
                .replace(/[\u201C\u201D]/g, '"') // curly double quotes → "
                .replace(/[\u2018\u2019]/g, "'") // curly single quotes → '
              const parsed = JSON.parse(normalized)
              if (Array.isArray(parsed) && parsed.length > 1) {
                threadTweets = parsed.map((t: unknown) => sanitizeXExternalLinks(sanitizeXCashtags(String(t))))
              }
            } catch {
              // If the content looks like a JSON array but failed to parse,
              // reject it — never publish raw JSON syntax as tweet text.
              if (looksLikeArray) {
                await supabase.from('generated_content').update({ status: 'failed', review_feedback: 'MalformedThread: JSON array inválido — permanentemente rejeitado' }).eq('id', item.id)
                errors.push(`${item.id}: MalformedThread`)
                entries.push({ content: item.content, platform, status: 'error', reason: 'MalformedThread' })
                continue
              }
              /* not JSON — treat as single tweet */
            }

            if (threadTweets) {
              // Thread: MUST have source media on first tweet. Never post text-only.
              const threadSourceMedia = item.curated_content_id ? await getSourceMedia(item.curated_content_id) : null
              const threadVideoUrl = threadSourceMedia?.videoUrl ?? null
              const threadImageUrl = threadSourceMedia?.imageUrl ?? null

              // X rejeita vídeo > 2min (HTTP 403) — corta ANTES de legendar, só quando necessário.
              const threadTrimmedVideoUrl = threadVideoUrl
                ? (await trimVideoForXIfNeeded(threadVideoUrl, item.id).catch(() => null)) ?? threadVideoUrl
                : null

              // Burn PT-BR karaoke subtitles if video has speech
              const threadFinalVideoUrl = threadTrimmedVideoUrl
                ? (await burnSubtitlesForX(threadTrimmedVideoUrl).catch(() => null)) ?? threadTrimmedVideoUrl
                : null

              const firstResult = threadFinalVideoUrl
                ? await xClient.publishWithVideo(threadTweets[0], threadFinalVideoUrl)
                : threadImageUrl
                  ? await xClient.publishWithMedia(threadTweets[0], threadImageUrl)
                  : await xClient.publish(threadTweets[0]) // no source media — post text-only per CLAUDE.md

              if (!firstResult.success || !firstResult.postId) {
                result = firstResult
              } else {
                let prevId = firstResult.postId
                let allOk = true
                for (const tweet of threadTweets.slice(1)) {
                  const replyResult = await xClient.reply(prevId, tweet)
                  if (!replyResult.success || !replyResult.postId) { allOk = false; break }
                  prevId = replyResult.postId
                }
                result = {
                  success: allOk,
                  postId: firstResult.postId,
                  postUrl: firstResult.postUrl,
                  error: allOk ? undefined : 'Thread partially failed',
                }
              }
            } else {
              // Single tweet — MUST have source media (image or video). Never post text-only.
              const xContent = sanitizeXExternalLinks(sanitizeXCashtags(item.content))
              const sourceMedia = item.curated_content_id ? await getSourceMedia(item.curated_content_id) : null
              if (sourceMedia?.videoUrl) {
                // X rejeita vídeo > 2min (HTTP 403) — corta ANTES de legendar, só quando necessário.
                const trimmedVideoUrl = (await trimVideoForXIfNeeded(sourceMedia.videoUrl, item.id).catch(() => null)) ?? sourceMedia.videoUrl
                // Video: burn PT-BR karaoke subtitles if speech detected, then publish.
                const processedVideoUrl = await burnSubtitlesForX(trimmedVideoUrl).catch(() => null)
                result = await xClient.publishWithVideo(xContent, processedVideoUrl ?? trimmedVideoUrl)
              } else if (sourceMedia?.imageUrl) {
                // Image: no text-only fallback — if upload fails, retry later.
                result = await xClient.publishWithMedia(xContent, sourceMedia.imageUrl)
              } else {
                // No source media — post text-only per CLAUDE.md rule
                result = await xClient.publish(xContent)
              }
            }
            break
          }
          case 'linkedin': {
            const liCreds = await getLinkedInCredentials(ctx.workspaceId)
            const liClient = new LinkedInClient(liCreds)
            // If curated content has source_url, use publishWithLink for link cards
            const curatedContent = item.curated_content as { source_url?: string } | null
            const sourceUrl = curatedContent?.source_url
            if (sourceUrl) {
              result = await liClient.publishWithLink(item.content, sourceUrl)
            } else {
              result = await liClient.publish(item.content)
            }
            break
          }
          case 'instagram': {
            // Per-workspace credentials from load-credentials (no env var fallback for account-specific fields).
            const igCreds = await getInstagramCredentials(ctx.workspaceId)
            if (!igCreds.igUserId || !igCreds.accessToken) {
              result = { success: false, error: 'Instagram credentials not configured for this workspace — skipping to prevent cross-workspace contamination' }
              break
            }
            const igClient = InstagramClient.fromWorkspace(igCreds)
            const format = item.target_format ?? 'instagram'

            if (format === 'reel') {
              // Reel flow: render slideshow video → publish as Reel
              result = await publishInstagramReel(igClient, item, ctx.workspaceId)
            } else {
              // Image / carousel flow

              // Try to parse structured Brand JSON content first
              type brandContent = {
                format?: string; caption?: string; image_prompt?: string; imagePrompt?: string
                headline?: string; context?: string; kpi?: string; eyebrow?: string; visual_mode?: string
                slides?: Array<{ type: 'cover'|'content'|'cta'; headline: string; body?: string; context?: string; kpi?: string; image_prompt?: string }>
              }
              let parsedbrand: brandContent | null = null
              try {
                parsedbrand = normalizebrandContent(parseAIJson<brandContent>(item.content) as Record<string, unknown>) as brandContent
              } catch { /* plain text */ }

              const isbrandStructured = !!(parsedbrand?.image_prompt && (parsedbrand?.headline || parsedbrand?.slides?.length))
              const staticNewsMetadata = ((item as unknown as { metadata?: Record<string, unknown> }).metadata ?? {}) as Record<string, unknown>
              const staticNewsImageUrls = Array.isArray(staticNewsMetadata.image_urls)
                ? staticNewsMetadata.image_urls.filter((value): value is string => typeof value === 'string')
                : []
              const isCuratedStaticNewsStructured = !!(
                staticNewsMetadata.static_news &&
                parsedbrand?.visual_mode === 'curated_image' &&
                parsedbrand.image_prompt &&
                (parsedbrand.headline || parsedbrand.slides?.length)
              )

              // Caption: extract from JSON if available, otherwise use raw content
              const rawIgCaption = parsedbrand?.caption ?? item.content
              const { cleanCaption: igCleanCaption, hashtags: igHashtags } = splitHashtags(rawIgCaption)

              // CTA throttle: max 2 comment-CTAs per 3-day window
              let caption = igCleanCaption
              if (hasCommentCta(igCleanCaption) && await isCommentCtaThrottled(ctx.workspaceId)) {
                caption = stripCommentCta(igCleanCaption)
                console.warn('[publisher] Comment CTA throttled — stripped from caption')
              }
              // B1: ~20% micro-variation to avoid repetitive caption structure fingerprint
              caption = applyMicroVariation(caption)
              const igAltText = caption.split('\n')[0].replace(/[#@]/g, '').trim().slice(0, 100)

              // Curated source image is only used for non-brand content.
              // Brand always generates its own branded image — never use the original tweet photo.
              const sourceMedia = (!isbrandStructured && !isCuratedStaticNewsStructured && item.curated_content_id)
                ? await getSourceMedia(item.curated_content_id)
                : null
              const allImageUrls = sourceMedia?.allImageUrls ?? []
              let imageUrl: string | null = sourceMedia?.imageUrl ?? null

              if (isCuratedStaticNewsStructured && parsedbrand?.format === 'carousel' && parsedbrand.slides && staticNewsImageUrls.length >= 2) {
                const { generatebrandCuratedCarousel } = await import('@/lib/ai/generate-brand-curated-carousel')
                const carouselUrls = await generatebrandCuratedCarousel({
                  slides: parsedbrand.slides,
                  sourceImageUrls: staticNewsImageUrls,
                  eyebrow: parsedbrand.eyebrow ?? 'BRASIL',
                  itemId: item.id,
                })

                if (carouselUrls) {
                  result = await igClient.publishCarousel(caption, carouselUrls, igAltText)
                  if (result.success && result.postId && igHashtags && Math.random() >= 0.12) {
                    igClient.postComment(result.postId, igHashtags).catch(() => {})
                  }
                  break
                }
              }

              if (isCuratedStaticNewsStructured && parsedbrand?.headline && staticNewsImageUrls[0]) {
                const { generatebrandCuratedPostImage } = await import('@/lib/ai/generate-brand-curated-post')
                imageUrl = await generatebrandCuratedPostImage({
                  headline: parsedbrand.headline,
                  context: parsedbrand.context ?? '',
                  kpi: parsedbrand.kpi,
                  eyebrow: parsedbrand.eyebrow ?? 'BRASIL',
                  sourceImageUrl: staticNewsImageUrls[0],
                  itemId: item.id,
                })
              }

              // ── Brand Carousel ────────────────────────────────────────
              if (isbrandStructured && parsedbrand?.format === 'carousel' && parsedbrand.slides && parsedbrand.slides.length >= 2 && parsedbrand.image_prompt) {
                const { generatebrandCarousel } = await import('@/lib/ai/generate-brand-carousel')
                const carouselUrls = await generatebrandCarousel({
                  slides:      parsedbrand.slides,
                  imagePrompt: parsedbrand.image_prompt,
                  itemId:      item.id,
                })
                if (!carouselUrls) {
                  result = { success: false, error: 'brand carousel generation failed — will retry' }
                  break
                }
                result = await igClient.publishCarousel(caption, carouselUrls, igAltText)
                // B2: 12% of posts skip hashtag comment (pattern variation against bot detection)
                if (result.success && result.postId && igHashtags && Math.random() >= 0.12) {
                  igClient.postComment(result.postId, igHashtags).catch(() => {})
                }
                if (result.success && result.postId) {
                  queueStoryUpdate(supabase, item.id, pickStoryCoverUrl({ carouselUrls }))
                }
                break
              }

              // ── Brand Single Feed Post ────────────────────────────────
              if (!imageUrl && isbrandStructured && parsedbrand?.headline && parsedbrand.image_prompt) {
                const { generatebrandPostImage } = await import('@/lib/ai/generate-brand-post-image')
                imageUrl = await generatebrandPostImage({
                  headline:    parsedbrand.headline,
                  context:     parsedbrand.context ?? '',
                  kpi:         parsedbrand.kpi,
                  imagePrompt: parsedbrand.image_prompt,
                  itemId:      item.id,
                })
              }

              if (format === 'carousel' && allImageUrls.length > 1) {
                result = await igClient.publishCarousel(caption, allImageUrls, igAltText)
              } else if (imageUrl) {
                result = await igClient.publishImage(caption, imageUrl, igAltText)
              } else {
                result = { success: false, error: 'Instagram requires an image URL from curated content' }
              }
              if (result.success && result.postId && igHashtags) {
                igClient.postComment(result.postId, igHashtags).catch(() => {})
              }
              if (result.success && result.postId) {
                queueStoryUpdate(supabase, item.id, pickStoryCoverUrl({ allImageUrls, imageUrl }))
              }
            }
            break
          }
          case 'youtube': {
            const ytCreds = await getYouTubeCredentials(ctx.workspaceId)
            const ytClient = YouTubeClient.fromEnv()
            const ytSourceMedia = await getSourceMedia(item.curated_content_id ?? '')
            const videoUrl = ytSourceMedia.videoUrl ?? ytSourceMedia.imageUrl
            if (!videoUrl) {
              result = { success: false, error: 'YouTube requires a video URL from curated content' }
              break
            }
            const ytResult = await ytClient.publishShort(
              item.content.split('\n')[0].slice(0, 100),
              item.content,
              videoUrl,
              ytCreds.defaultTags,
            )
            result = { success: ytResult.success, postId: ytResult.videoId, postUrl: ytResult.videoUrl, error: ytResult.error }
            break
          }
          default:
            result = { success: false, error: `Unknown platform: ${platform}` }
        }

        if (!result.success) {
          if (result.qualityReview?.outcome === 'rejected') {
            const existingMetadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
              ? item.metadata
              : {}
            await supabase
              .from('generated_content')
              .update({
                status: 'rejected',
                review_score: result.qualityReview.score,
                review_feedback: result.qualityReview.feedback,
                review_issues: result.qualityReview.issues,
                metadata: { ...existingMetadata, final_quality_review: result.qualityReview },
              })
              .eq('id', item.id)
            entries.push({
              content: item.content,
              platform,
              status: 'rejected',
              reason: result.qualityReview.feedback,
            })
            continue
          }

          // Track retry count — give up after N attempts (Q34)
          const maxRetries = retryAttempts || 3
          const retryCount = ((item as any).retry_count ?? 0) + 1
          // 4xx errors are permanent (bad request/auth/billing); 5xx and network errors are retryable
          const isPermanent = /40[0-9]|rejected|permanent/i.test(result.error ?? '')
          if (retryCount >= maxRetries || isPermanent) {
            await supabase
              .from('generated_content')
              .update({ status: 'failed', retry_count: retryCount, review_feedback: isPermanent ? `Falha permanente: ${result.error}` : `Failed after ${retryCount} attempts: ${result.error}` })
              .eq('id', item.id)
          } else {
            // Release claim so the item is retried on the next run
            await supabase
              .from('generated_content')
              .update({ status: 'approved', retry_count: retryCount })
              .eq('id', item.id)
          }

          const reason = `erro API [${platform}] (tentativa ${retryCount}/${maxRetries}): ${result.error}`
          errors.push(`${item.id}: ${result.error}`)
          entries.push({ content: item.content, platform, status: 'error', reason: result.error ?? 'unknown' })
          continue
        }

        // 6. Update with real publish data
        const publishedMetadata = item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
          ? item.metadata
          : {}
        await supabase
          .from('generated_content')
          .update({
            status: 'published',
            published_id: result.postId ?? null,
            published_url: result.postUrl ?? null,
            published_at: new Date().toISOString(),
            metadata: result.qualityReview
              ? { ...publishedMetadata, final_quality_review: result.qualityReview }
              : publishedMetadata,
          })
          .eq('id', item.id)

        entries.push({
          content: item.content,
          platform,
          status: 'published',
          url: result.postUrl ?? undefined,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        // Release the claim and increment retry_count so the item eventually gets retired
        const retryCount = ((item as any).retry_count ?? 0) + 1
        const maxRetries = retryAttempts || 3
        const isPermanentException = /40[0-9]|rejected|permanent/i.test(msg)
        await finalizeExceptionRetry(supabase, item.id, retryCount, maxRetries, isPermanentException, msg)
        errors.push(`${item.id}: ${msg}`)
        entries.push({ content: item.content, platform, status: 'error', reason: msg })
      }
    }

    const published = entries.filter((e) => e.status === 'published').length
    const rejected = entries.filter((e) => e.status === 'rejected').length
    const errored = entries.filter((e) => e.status === 'error').length

    return {
      success: errored === 0,
      itemsProcessed: content.length,
      itemsProduced: published,
      errors,
      tokensUsed: 0,
      costEstimate: 0,
      durationMs: Date.now() - startTime,
      details: { entries, published, rejected, errored },
    }
  }

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as { published: number; rejected: number; errored: number }
    return {
      agentSlug: 'publisher',
      inputSummary: `${result.itemsProcessed} items to publish`,
      outputSummary: `${d.published} published, ${d.rejected} rejected, ${d.errored} errors`,
      autoScore: result.success ? 8 : 4,
      dimensions: {
        reliability: d.errored === 0 ? 10 : 5,
        throughput: d.published > 0 ? 8 : 3,
        quality: d.rejected === 0 ? 9 : 6,
      },
      issues: result.errors,
      verdict: result.success ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as {
      entries: PublishEntry[]
      published: number
      rejected: number
      errored: number
      reason?: string
    }

    if (result.itemsProcessed === 0) {
      return '' // Nothing to publish — stay silent
    }
    if (d.published === 0 && d.errored === 0) {
      return '' // All rejected (quality gate) — no need to alert
    }
    if (d.published === 0 && d.errored > 0) {
      // All attempts failed — report errors
      return `❌ *Publicador — Falha total*\n\n${d.errored} item(s) falharam:\n${result.errors.slice(0, 3).join('\n').slice(0, 400)}`
    }

    const lines: string[] = [
      '📤 *Publicador — Publicação Completa*',
      '',
      `📊 ${result.itemsProcessed} processados | ✅ ${d.published} publicados | ❌ ${d.rejected} rejeitado${d.rejected !== 1 ? 's' : ''} | ⏭️ ${d.errored} erro${d.errored !== 1 ? 's' : ''}`,
      '',
    ]

    for (const entry of d.entries) {
      const platformIcon = PLATFORM_ICONS[entry.platform] ?? '📤'
      const preview = entry.content.length > 40
        ? entry.content.slice(0, 40) + '...'
        : entry.content

      if (entry.status === 'published') {
        const urlDisplay = entry.url && entry.url !== 'dry_run'
          ? `→ ${entry.url}`
          : entry.url === 'dry_run'
            ? '→ _dry run_'
            : ''
        lines.push(`${platformIcon} ✅ "${preview}" ${urlDisplay}`)
      } else if (entry.status === 'rejected') {
        lines.push(`${platformIcon} ❌ "${preview}" → _${entry.reason}_`)
      } else if (entry.status === 'error') {
        lines.push(`${platformIcon} ⚠️ "${preview}" → _${entry.reason}_`)
      }
    }

    lines.push('')
    lines.push(`⏱️ ${(result.durationMs / 1000).toFixed(1)}s`)

    return lines.join('\n')
  }
}

export const agent = new PublisherAgent()

// Exported for regression tests
export type { }
export function normalizebrandContent(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.imagePrompt && !raw.image_prompt) raw.image_prompt = raw.imagePrompt
  return raw
}

export function buildStoryQueuePatch(coverUrl: string): {
  story_cover_url: string
  story_publish_after: string
  story_delay_minutes: number
} {
  const storyDelayMin = 8 + Math.floor(Math.random() * 37) // A1: 8–44 min
  return {
    story_cover_url: coverUrl,
    story_publish_after: new Date(Date.now() + storyDelayMin * 60 * 1000).toISOString(),
    story_delay_minutes: storyDelayMin,
  }
}

export function pickStoryCoverUrl(params: {
  carouselUrls?: string[] | null
  allImageUrls?: string[]
  imageUrl?: string | null
}): string | null {
  if (params.carouselUrls?.[0]) return params.carouselUrls[0]
  if (params.allImageUrls?.[0]) return params.allImageUrls[0]
  return params.imageUrl ?? null
}

/** Fire-and-forget: queue a Story for `itemId` using `coverUrl`, if one was resolved. */
function queueStoryUpdate(supabase: ReturnType<typeof getAdminClient>, itemId: string, coverUrl: string | null): void {
  if (!coverUrl) return
  supabase.from('generated_content').update(buildStoryQueuePatch(coverUrl)).eq('id', itemId).then(() => {}, () => {})
}
