export const maxDuration = 300

import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { WORKSPACE_ID, INSTAGRAM_API_BASE } from '@/lib/config/constants'
import { AI_SENTINEL } from '@/lib/ai/generate-with-fallback'
import { applyMicroVariation } from '@/lib/platforms/instagram/client'
import { publishFinishedContainer } from '@/lib/platforms/instagram/publish-container'

/**
 * PHASE 2: Render + Publish.
 *
 * 1. Picks up reel_ready from Phase 1
 * 2. Parallel render: cover (Remotion) + video (FFmpeg CapCut) on Railway
 * 3. Publishes to Instagram with cover
 * 4. Shares to Stories
 * 5. Cross-posts to Twitter
 */

/**
 * Generate editorial cover via Satori (/api/og/reel) and upload to Supabase storage.
 * Returns the public URL of the cover PNG, or null on failure.
 */
const BRAND_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

async function generateEditorialCover(params: {
  itemId: string
  hookTitle: string
  highlightWords: string[]
  subtitle: string
  backgroundUrl?: string
  workspaceId: string
  kpi?: string
}): Promise<string | null> {
  const supabase = getAdminClient()
  const base = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.APP_BASE_URL ?? null
  if (!base) return null

  try {
    let ogPath: string
    let qs: URLSearchParams

    if (params.workspaceId === BRAND_WORKSPACE_ID) {
      // Brand: use branded cover with violet/EV theme — full hook phrase for max info
      qs = new URLSearchParams({
        hookTitle: params.hookTitle,
        highlightName: params.subtitle || params.hookTitle,
        ...(params.backgroundUrl ? { bg: params.backgroundUrl } : {}),
        ...(params.kpi ? { kpi: params.kpi } : {}),
      })
      ogPath = 'brand-reel-cover'
    } else {
      // AI & Tech (@thedoomguy_ai): use red/editorial cover
      qs = new URLSearchParams({
        title: params.hookTitle,
        highlight: params.highlightWords.join(','),
        subtitle: params.subtitle,
        ...(params.backgroundUrl ? { bg: params.backgroundUrl } : {}),
      })
      ogPath = 'reel'
    }

    const res = await fetch(`${base}/api/og/${ogPath}?${qs.toString()}`, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      console.error(`[reels-publish] Satori cover failed: ${res.status}`)
      return null
    }
    const png = new Uint8Array(await res.arrayBuffer())
    const path = `covers/editorial-${params.itemId}.png`
    const { error } = await supabase.storage
      .from('reels')
      .upload(path, png, { contentType: 'image/png', upsert: true })
    if (error) {
      console.error('[reels-publish] Cover upload failed:', error.message)
      return null
    }
    const { data: urlData } = supabase.storage.from('reels').getPublicUrl(path)
    return urlData.publicUrl ?? null
  } catch (err) {
    console.error('[reels-publish] generateEditorialCover error:', err instanceof Error ? err.message : err)
    return null
  }
}
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Allow workspace override via ?workspaceId= query param (for Brand cron entry)
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspaceId') || WORKSPACE_ID

  const supabase = getAdminClient()
  const REEL_RENDERER_URL = process.env.REEL_RENDERER_URL || ''
  const REEL_RENDERER_API_KEY = process.env.REEL_RENDERER_API_KEY || ''

  // C1: Reach trend cooldown — skip if declining reach paused this workspace for 48h
  const reelPauseUntil = await getVariable(workspaceId, 'reel_pause_until').catch(() => '')
  if (reelPauseUntil && new Date(reelPauseUntil) > new Date()) {
    return NextResponse.json({ ok: true, skipped: 'reach_trend_cooldown', until: reelPauseUntil })
  }

  // ── Get reel_ready item ──
  const { data: items } = await supabase
    .from('generated_content')
    .select('id, content, curated_content_id')
    .eq('workspace_id', workspaceId)
    .eq('target_format', 'reel')
    .eq('status', 'reel_ready')
    .order('created_at', { ascending: true })
    .limit(1)

  if (!items?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_reel_ready' })
  }

  const item = items[0]
  let reelData: {
    videoUrl: string
    backgroundUrl?: string
    subtitles: Array<{ text: string; startFrame: number; endFrame: number }>
    hookTitle: string
    highlightWords: string[]
    highlightClause?: string
    subtitle?: string
    kpi?: string
    caption: string
    sourceAuthor: string
  }

  try {
    reelData = JSON.parse(item.content as string)
  } catch {
    await supabase.from('generated_content').update({ status: 'failed', review_feedback: 'Invalid JSON in content field — malformed data cannot be processed' }).eq('id', item.id)
    return NextResponse.json({ ok: false, error: 'Invalid JSON' })
  }

  // ── Gate: never publish without a cinematic background photo ──
  // coverUrl (gerado pelo Satori) pode ser não-nulo mesmo sem backgroundUrl —
  // porque o Satori gera uma capa com gradiente como fallback. Checar aqui,
  // ANTES de qualquer render, garante que não gastamos recursos em reels inválidos.
  if (!reelData.backgroundUrl) {
    await supabase.from('generated_content')
      .update({ status: 'failed', review_feedback: 'no_background_generated — publicação bloqueada sem foto cinematográfica' })
      .eq('id', item.id)
    return NextResponse.json({ ok: false, error: 'No cinematic background photo — refusing to publish gradient cover' })
  }

  // ── Gate: reject items missing required fields — malformed content must never crash the cron ──
  // Bug 2026-07-12: item sem `caption` fazia reelData.caption.length lançar TypeError não
  // capturado, derrubando o handler com 500 antes de marcar o item como failed. Como a fila
  // é FIFO por created_at, o item corrompido nunca saía da frente e travava todos os itens
  // válidos atrás dele por dias.
  if (typeof reelData.caption !== 'string' || !Array.isArray(reelData.subtitles)) {
    await supabase.from('generated_content')
      .update({ status: 'failed', review_feedback: 'missing_required_fields — caption ou subtitles ausentes' })
      .eq('id', item.id)
    return NextResponse.json({ ok: false, error: 'Missing required fields — rejected' })
  }

  // ── Quality gate: reject garbage content before spending resources ──
  if (reelData.caption.length < 100) {
    await supabase.from('generated_content').update({ status: 'failed', review_feedback: 'Caption too short (<100 chars)' }).eq('id', item.id)
    return NextResponse.json({ ok: false, error: 'Caption too short — rejected' })
  }
  if (reelData.subtitles.length > 0) {
    const subText = reelData.subtitles.map(s => s.text).join(' ')
    if (/música|encerramento|music|♪|🎶/i.test(subText) && subText.length < 50) {
      await supabase.from('generated_content').update({ status: 'failed', review_feedback: 'Subtitles are music markers, not speech' }).eq('id', item.id)
      return NextResponse.json({ ok: false, error: 'Subtitles are music markers — rejected' })
    }
  }

  // ── Gate: validate frame layout before spending render resources ──
  // Checks that hookTitle fits visibly (no overflow into video, no truncation).
  // Uses the same geometry as the renderers — pure math, no FFmpeg, responds in <100ms.
  // Non-blocking: if the validator itself is unreachable, log and continue.
  try {
    const validateUrl = new URL(`${REEL_RENDERER_URL}/validate-layout`)
    validateUrl.searchParams.set('title', reelData.hookTitle)
    const vRes = await fetch(validateUrl.toString(), {
      headers: { Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (vRes.ok || vRes.status === 422) {
      const vData = await vRes.json() as { ok: boolean; errors: string[]; warnings: string[] }
      if (!vData.ok) {
        console.error('[reels-publish] Layout validation failed:', vData.errors.join(' | '))
        await supabase.from('generated_content')
          .update({ status: 'failed', review_feedback: `layout_invalid: ${vData.errors.join(' | ').slice(0, 300)}` })
          .eq('id', item.id)
        return NextResponse.json({ ok: false, error: 'layout_invalid', detail: vData.errors })
      }
      if (vData.warnings?.length) {
        console.warn('[reels-publish] Layout warnings:', vData.warnings.join(' | '))
      }
    }
  } catch (err) {
    // Validator unreachable — do not block publish
    console.warn('[reels-publish] Layout validator unreachable (continuing):', err instanceof Error ? err.message : err)
  }

  // ── Load configurable values ──
  const [instagramHandle, coverRenderTimeout, videoRenderTimeout, igPollInterval, igPollMaxAttempts] = await Promise.all([
    getVariable(workspaceId, 'instagram_handle'),
    getNumericVariable(workspaceId, 'cover_render_timeout_ms'),
    getNumericVariable(workspaceId, 'video_render_timeout_ms'),
    getNumericVariable(workspaceId, 'ig_poll_interval_ms'),
    getNumericVariable(workspaceId, 'ig_poll_max_attempts'),
  ])

  // ── Render cover + video IN PARALLEL ──
  console.log(`[reels-publish] Rendering @${reelData.sourceAuthor} (parallel)`)

  let renderedVideoUrl = reelData.videoUrl

  const renderCover = async (): Promise<string | null> => {
    if (!reelData.backgroundUrl) return null
    const res = await fetch(`${REEL_RENDERER_URL}/render/remotion`, {
      method: 'POST',
      signal: AbortSignal.timeout(coverRenderTimeout),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
      body: JSON.stringify({
        composition: 'CoverImage',
        inputProps: {
          backgroundUrl: reelData.backgroundUrl,
          title: reelData.hookTitle,
          highlightWords: reelData.highlightWords,
          subtitle: reelData.subtitle || '',
          handle: instagramHandle,
        },
      }),
    })
    if (!res.ok) throw new Error(`Cover: ${res.status}`)
    const r = await res.json() as { url: string }
    return r.url
  }

  const renderVideo = async (): Promise<string | null> => {
    if (workspaceId !== BRAND_WORKSPACE_ID) {
      // AI & Tech (@thedoomguy_ai): branded frame — landscape + portrait sized correctly,
      // header with logo/handle/category/title, karaoke subtitles in video slot.
      // Always render regardless of whether subtitles exist.
      const res = await fetch(`${REEL_RENDERER_URL}/render/doomguy-frame`, {
        method: 'POST',
        signal: AbortSignal.timeout(videoRenderTimeout),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
        body: JSON.stringify({
          videoUrl: reelData.videoUrl,
          subtitles: reelData.subtitles,
          fps: 30,
          hookTitle: reelData.hookTitle,
          categoria: 'ARTIFICIAL INTELLIGENCE',
          // Estilo editorial @ato: cláusula-chave em destaque no título queimado
          highlightClause: reelData.highlightClause ?? '',
          highlightWords: reelData.highlightWords ?? [],
        }),
      })
      if (!res.ok) throw new Error(`DoomGuyFrame: ${res.status}`)
      const r = await res.json() as { url: string }
      return r.url
    }
    // Brand: branded frame — logo, @brand, violet category, hook title, karaoke subtitles.
    // Always render regardless of whether subtitles exist (brand consistency).
    const res = await fetch(`${REEL_RENDERER_URL}/render/brand-frame`, {
      method: 'POST',
      signal: AbortSignal.timeout(videoRenderTimeout),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REEL_RENDERER_API_KEY}` },
      body: JSON.stringify({
        videoUrl: reelData.videoUrl,
        subtitles: reelData.subtitles,
        fps: 30,
        hookTitle: reelData.hookTitle,
      }),
    })
    if (!res.ok) throw new Error(`brandFrame: ${res.status}`)
    const r = await res.json() as { url: string }
    return r.url
  }

  // Run all three renders in parallel — CRITICAL for §5 (CLAUDE.md):
  // generateEditorialCover must start AT THE SAME TIME as renderCover so Satori fetches
  // reelData.backgroundUrl (raw OpenAI image) BEFORE Railway can potentially overwrite
  // that Supabase path with its own rendered output. Running Satori AFTER Railway completes
  // causes a race condition where the bg URL already points to the Remotion cover (with title)
  // → Satori adds its own title on top → duplicate title on the final cover.
  const [coverResult, videoResult, editorialResult] = await Promise.allSettled([
    renderCover(),
    renderVideo(),
    generateEditorialCover({
      itemId: item.id,
      hookTitle: reelData.hookTitle,
      highlightWords: reelData.highlightWords,
      subtitle: reelData.subtitle ?? '',
      backgroundUrl: reelData.backgroundUrl,  // raw OpenAI photo — NOT Remotion output
      workspaceId,
      kpi: reelData.kpi,
    }),
  ])

  if (videoResult.status === 'fulfilled' && videoResult.value) {
    renderedVideoUrl = videoResult.value
    console.log(`[reels-publish] ✓ Video: ${renderedVideoUrl}`)
  } else if (videoResult.status === 'rejected') {
    const capErr = videoResult.reason?.message || String(videoResult.reason)
    console.error('[reels-publish] Video render failed:', capErr)
    if (workspaceId !== BRAND_WORKSPACE_ID) {
      // AI & Tech: doomguy-frame always renders — if it fails the source format is unknown.
      // Never send raw video to Instagram; it could be landscape → infinite IN_PROGRESS polling.
      await supabase.from('generated_content')
        .update({ status: 'failed', review_feedback: `doomguy_frame_failed: ${capErr.slice(0, 200)}` })
        .eq('id', item.id)
      return NextResponse.json({ ok: false, error: 'doomguy_frame_failed', detail: capErr.slice(0, 200) })
    }
    // Brand: brand-frame always renders — if it fails the source format is unknown.
    await supabase.from('generated_content')
      .update({ status: 'failed', review_feedback: `brand_frame_failed: ${capErr.slice(0, 200)}` })
      .eq('id', item.id)
    return NextResponse.json({ ok: false, error: 'brand_frame_failed', detail: capErr.slice(0, 200) })
  }

  const editorialCoverUrl = editorialResult.status === 'fulfilled' ? editorialResult.value : null
  const coverUrl = editorialCoverUrl ?? (coverResult.status === 'fulfilled' ? coverResult.value : null)

  // Gate: never publish a reel without a cinematic cover photo.
  if (!coverUrl) {
    await supabase.from('generated_content')
      .update({ status: 'failed', review_feedback: 'no_cover_generated — publicação bloqueada sem foto de fundo' })
      .eq('id', item.id)
    return NextResponse.json({ ok: false, error: 'Cover not generated — refusing to publish without cinematic background' })
  }

  // ── Publish to Instagram ──
  // ISOLATION: load per-workspace credentials from DB — NEVER from env vars.
  // Env vars (INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN) belong to Brand;
  // using them here caused cross-workspace contamination (fix: reels-publish-credentials).
  const { igUserId, accessToken: igToken } = await getInstagramCredentials(workspaceId)
  if (!igUserId || !igToken) {
    return NextResponse.json({ ok: false, error: 'IG credentials missing for workspace' })
  }

  // IGAA tokens (Instagram-scoped) only work on graph.instagram.com.
  // EAA tokens (Facebook Page Access) only work on graph.facebook.com.
  // Both token types are in use across workspaces — detect at runtime.
  const igApiBase = igToken.startsWith('IGAA')
    ? `https://graph.instagram.com/v22.0`
    : INSTAGRAM_API_BASE

  // Anti-shadowban: strip hashtags from caption — post as first comment after publish
  const hashtagRegex = /#[\w\u00C0-\u017E]+/g
  const captionHashtags = (reelData.caption.match(hashtagRegex) ?? []).join(' ')
  let captionClean = reelData.caption.replace(hashtagRegex, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  // Anti-shadowban: CTA throttle — max 2 "comenta X" CTAs per 3-day window
  if (/(^|\n|[.!?]\s+)comenta\s+\w+/i.test(captionClean)) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
    const { count: ctaCount } = await supabase
      .from('generated_content')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('status', 'published')
      .ilike('content', '%comenta %')
      .gte('published_at', threeDaysAgo)
    if ((ctaCount ?? 0) >= 2) {
      captionClean = captionClean.replace(/comenta\s+\w+[^\n]*/gi, '').replace(/\n{3,}/g, '\n\n').trim()
      console.warn('[reels-publish] Comment CTA throttled — stripped from caption')
    }
  }

  // B1: ~20% micro-variation in caption structure to avoid repetitive bot fingerprint
  captionClean = applyMicroVariation(captionClean)

  const containerBody: Record<string, unknown> = {
    media_type: 'REELS',
    video_url: renderedVideoUrl,
    caption: captionClean,
    share_to_feed: true,
    access_token: igToken,
  }
  containerBody.cover_url = coverUrl
  // NOTE: alt_text is NOT supported for REELS (IG API #100 error) — skipped

  console.log(`[reels-publish] Creating container — videoUrl=${renderedVideoUrl?.slice(0, 80)} coverUrl=${coverUrl?.slice(0, 80)}`)
  // Had no timeout at all before — a hung container-creation call could block indefinitely,
  // eating into the 300s maxDuration shared with the render step above.
  const cRes = await fetch(`${igApiBase}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(containerBody),
    signal: AbortSignal.timeout(15_000),
  })
  const cData = await cRes.json() as { id?: string; error?: { message: string; code?: number } }
  console.log(`[reels-publish] Container creation status=${cRes.status} id=${cData.id} error=${JSON.stringify(cData.error ?? null).slice(0, 200)}`)

  if (!cData.id) {
    await supabase.from('generated_content').update({ status: 'failed', review_feedback: `IG: ${cData.error?.message}` }).eq('id', item.id)
    return NextResponse.json({ ok: false, error: `IG failed: ${cData.error?.message}` })
  }

  let postId: string | null = null
  let igContainerError: string | null = null
  let lastPollResponse = ''
  console.log(`[reels-publish] Starting poll — containerId=${cData.id} attempts=${igPollMaxAttempts} interval=${igPollInterval}ms`)
  for (let i = 0; i < igPollMaxAttempts; i++) {
    await new Promise(r => setTimeout(r, igPollInterval))
    // Use ids= batch format — direct /{container-id} node query returns Authorization Error (subcode 33)
    // for EAA tokens even when the token is valid for creation. ids= uses a different access path.
    // Had no timeout at all before — a single hung poll fetch could block indefinitely, uncounted
    // by the loop's own attempt-count budget (which only limits ITERATIONS, not per-call wall clock).
    // Caught (not rethrown) so one stalled poll doesn't crash the whole handler — treated as
    // inconclusive, loop just continues to the next attempt.
    const sRaw = await fetch(`${igApiBase}/?ids=${cData.id}&fields=status_code&access_token=${igToken}`, {
      signal: AbortSignal.timeout(10_000),
    })
      .then(r => r.json() as Promise<Record<string, { status_code?: string; error?: { message: string; code: number } }>>)
      .catch((err) => {
        console.warn(`[reels-publish] Poll ${i + 1}/${igPollMaxAttempts} request failed:`, err instanceof Error ? err.message : err)
        return {} as Record<string, { status_code?: string; error?: { message: string; code: number } }>
      })
    const sd = sRaw[cData.id] ?? {}
    lastPollResponse = JSON.stringify(sRaw).slice(0, 200)
    console.log(`[reels-publish] Poll ${i + 1}/${igPollMaxAttempts}: ${lastPollResponse}`)
    if (sd.status_code === 'FINISHED') {
      // Retry: o Instagram às vezes recusa media_publish nos primeiros segundos
      // após FINISHED ("container ainda não publicável"). Sem retry, o reel era
      // marcado failed mesmo pronto. Ver publish-container.ts.
      const pub = await publishFinishedContainer(igApiBase, igUserId, igToken, cData.id)
      postId = pub.id
      if (!postId) {
        igContainerError = `ig_publish_failed (creation_id=${cData.id}): ${pub.error}`
      }
      break
    }
    if (sd.status_code === 'ERROR') {
      // Fetch extended error detail using same ids= pattern
      try {
        const errRes = await fetch(`${igApiBase}/?ids=${cData.id}&fields=status_code,video_status&access_token=${igToken}`, {
          signal: AbortSignal.timeout(10_000),
        })
        const errRaw = await errRes.json() as Record<string, { video_status?: { status: string; processing_progress?: number } }>
        const errData = errRaw[cData.id] ?? {}
        igContainerError = `IG_ERROR: ${JSON.stringify(errData.video_status ?? 'unknown')}`
      } catch {
        igContainerError = 'IG_ERROR: unknown'
      }
      break
    }
  }

  if (!postId) {
    const feedbackMsg = igContainerError ?? `ig_poll_timeout — last: ${lastPollResponse}`
    await supabase.from('generated_content')
      .update({ status: 'failed', review_feedback: feedbackMsg })
      .eq('id', item.id)
    // Block source from cycling through prepare→publish again for 24h
    const curatedId = (item as Record<string, unknown>).curated_content_id as string | null
    if (curatedId) {
      const skipUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      await supabase.from('curated_content')
        .update({ skip_reason: AI_SENTINEL.PUBLISH_FAILED, skip_until: skipUntil })
        .eq('id', curatedId)
    }
    return NextResponse.json({ ok: false, error: 'IG publish failed', detail: feedbackMsg })
  }

  await supabase.from('generated_content').update({
    status: 'published', published_id: postId,
    published_url: `https://www.instagram.com/reel/${postId}`,
    published_at: new Date().toISOString(),
  }).eq('id', item.id)

  // Anti-shadowban: A2 — delay 30-120s before hashtag comment (instant = bot signal)
  // B2 — 12% of posts skip the hashtag comment entirely (pattern variation)
  if (captionHashtags && postId) {
    if (Math.random() >= 0.12) {
      const hashtagDelayMs = 30_000 + Math.floor(Math.random() * 90_000) // 30–120s
      console.log(`[reels-publish] A2: Hashtag comment delayed ${Math.round(hashtagDelayMs / 1000)}s`)
      await new Promise(r => setTimeout(r, hashtagDelayMs))
      try {
        const commentUrl = new URL(`${igApiBase}/${postId}/comments`)
        commentUrl.searchParams.set('message', captionHashtags)
        commentUrl.searchParams.set('access_token', igToken)
        const commentRes = await fetch(commentUrl.toString(), { method: 'POST', signal: AbortSignal.timeout(10_000) })
        const commentData = await commentRes.json() as { id?: string; error?: { message: string; code?: number } }
        if (commentRes.ok && commentData.id) {
          console.log(`[reels-publish] Hashtag comment posted id=${commentData.id} (${captionHashtags.split(' ').length} tags)`)
        } else {
          console.error(`[reels-publish] Hashtag comment FAILED status=${commentRes.status} error=${JSON.stringify(commentData.error ?? commentData).slice(0, 200)}`)
        }
      } catch (e) {
        console.error(`[reels-publish] Hashtag comment exception: ${e}`)
      }
    } else {
      console.log('[reels-publish] B2: Hashtag comment skipped (12% omission pattern)')
    }
  }

  // A1: Queue story for deferred publish (8-45min delay) — stories-publisher cron processes it.
  // Anti-shadowban: instant story after feed post (0s) = bot fingerprint.
  // Replaces the previous inline 45-90s setTimeout which still ran within the same request.
  // Reposta o vídeo curado (renderedVideoUrl), não a capa gerada — a capa é só a thumbnail do feed.
  const storyId: string | null = null
  if (renderedVideoUrl) {
    const storyDelayMin = 8 + Math.floor(Math.random() * 37) // 8–44 min
    try {
      await supabase.from('generated_content').update({
        story_video_url: renderedVideoUrl,
        story_publish_after: new Date(Date.now() + storyDelayMin * 60 * 1000).toISOString(),
        story_delay_minutes: storyDelayMin,
      }).eq('id', item.id)
    } catch { /* A1 queue write failure is non-critical */ }
    console.log(`[reels-publish] A1: Story queued for publish in ${storyDelayMin}min (stories-publisher cron)`)
  }

  // C1: Reach trend — if last 5 posts show declining reach, pause publishes 48h
  try {
    const { data: reachRows } = await supabase
      .from('generated_content')
      .select('reach')
      .eq('workspace_id', workspaceId)
      .eq('status', 'published')
      .not('reach', 'is', null)
      .order('published_at', { ascending: false })
      .limit(5)
    if (reachRows && reachRows.length >= 3) {
      const reaches = reachRows.map(r => (r as { reach: number }).reach)
      const n = reaches.length
      const xMean = (n - 1) / 2
      const yMean = reaches.reduce((a, b) => a + b, 0) / n
      const ssxx = reaches.reduce((sum, _, i) => sum + (i - xMean) ** 2, 0)
      const ssxy = reaches.reduce((sum, r, i) => sum + (i - xMean) * (r - yMean), 0)
      const slope = ssxx > 0 ? ssxy / ssxx : 0
      const normalizedSlope = yMean > 0 ? slope / yMean : 0
      if (normalizedSlope < -0.1) {
        const pauseUntil = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
        try {
          await supabase.from('workspace_settings').upsert(
            { workspace_id: workspaceId, key: 'reel_pause_until', value: pauseUntil, category: 'pipeline' },
            { onConflict: 'workspace_id,key' },
          )
        } catch { /* C1 upsert failure is non-critical */ }
        console.warn(`[reels-publish] C1: Declining reach (slope=${normalizedSlope.toFixed(2)}) — pausing 48h until ${pauseUntil}`)
      }
    }
  } catch { /* C1 is non-critical */ }

  // ── Cross-post to Twitter — AI & Tech only (@thedoomguy_ai has X; Brand does not) ──
  let tweetId: string | null = null
  if (workspaceId !== BRAND_WORKSPACE_ID) {
    try {
      const { XClient } = await import('@/lib/platforms/x/client')
      const xClient = XClient.fromEnv()
      const captionClean = reelData.caption.replace(/#\w+\s*/g, '').replace(/@thedoomguy_ia|@inteligencia\.artificial\.brazil/gi, '').trim()
      const tweetText = captionClean.slice(0, 220) + `\n\n📲 Siga no Instagram: instagram.com/inteligencia.artificial.brazil`
      const xResult = await xClient.publishWithVideo(tweetText, renderedVideoUrl)
      tweetId = xResult.postId || null
    } catch { /* best effort */ }
  }

  // ── Cross-post to YouTube Shorts — AI & Tech only (Brand has no YouTube channel) ──
  let youtubeId: string | null = null
  if (workspaceId !== BRAND_WORKSPACE_ID) {
    try {
      const { YouTubeClient } = await import('@/lib/platforms/youtube/client')
      const ytClient = YouTubeClient.fromEnv()
      const ytDescription = reelData.caption.replace(/@thedoomguy_ia|@inteligencia\.artificial\.brazil/gi, '@inteligencia.artificial.brazil').trim()
        + `\n\n📲 Instagram: https://instagram.com/inteligencia.artificial.brazil`
        + `\n🐦 Twitter/X: https://x.com/thedoomguy_ai`
      const ytTags = ['IA', 'inteligencia artificial', 'AI', 'tecnologia', 'tech', 'machine learning']
      const ytResult = await ytClient.publishShort(reelData.hookTitle, ytDescription, renderedVideoUrl, ytTags)
      youtubeId = ytResult.videoId || null
    } catch { /* best effort */ }
  }

  console.log(`[reels-publish] ✅ IG=${postId} Story=${storyId} X=${tweetId} YT=${youtubeId}`)

  return NextResponse.json({
    ok: true, postId, tweetId, storyId, youtubeId,
    author: reelData.sourceAuthor,
    hookTitle: reelData.hookTitle,
    subtitles: reelData.subtitles.length,
    cover: !!coverUrl,
    videoRendered: renderedVideoUrl !== reelData.videoUrl,
  })
}
