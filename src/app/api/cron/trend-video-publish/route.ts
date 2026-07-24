import * as Sentry from '@sentry/nextjs'
import { WORKSPACE_ID } from '@/lib/config/constants'
// 280 (era 120, 2026-07-15): 120s não cobria nem a etapa de stitch de vídeo sozinha
// (stitchTrendVideoClips: até 60s de download paralelo + até 120s de execFile do ffmpeg =
// até 180s), muito menos somada à geração de capa/endcard (~20s) e ao publish do carrossel
// misto no Instagram (loop sequencial por item + poll final, até ~180s no pior caso).
// 280s ainda não cobre o pior caso absoluto (todas as etapas no teto simultaneamente,
// ~380s) — isso exigiria separar stitch/publish em crons distintos (fila), uma mudança de
// arquitetura maior que um ajuste de timeout. Ver commit para contexto completo.
export const maxDuration = 280

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { getNumericVariable, getVariable } from '@/lib/settings/load-settings'
import { InstagramClient, applyMicroVariation } from '@/lib/platforms/instagram/client'
import { generateTrendCarouselEndcard } from '@/lib/ai/generate-trend-carousel-endcard'
import { buildTrendGiveawayPackage } from '@/lib/trends/trend-giveaway'
import {
  supportsTrendVideoGenerationMemory,
  withOptionalTrendVideoGenerationMemory,
} from '@/lib/trends/trend-video-schema'
import { runTrendVideoQualityGate } from '@/lib/trends/trend-video-quality'
import { analyzeTrendVideoVisualQuality } from '@/lib/video/trend-video-visual-qa'
import { recoverTrendVideoSegments } from '@/lib/video/trend-video-recovery'
import { stitchTrendVideoClips } from '@/lib/video/stitch-trend-video'

function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function isEnabled(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [enabledRaw, maxJobsPerDay, publishPlatformsRaw, defaultCta, instagramHandle] = await Promise.all([
    getVariable(WORKSPACE_ID, 'trend_video_enabled'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_max_jobs_per_day'),
    getVariable(WORKSPACE_ID, 'trend_video_publish_platforms'),
    getVariable(WORKSPACE_ID, 'trend_video_default_cta'),
    getVariable(WORKSPACE_ID, 'instagram_handle'),
  ])

  if (!isEnabled(enabledRaw)) {
    return NextResponse.json({ ok: true, skipped: 'trend_video_disabled' })
  }

  const publishPlatforms = new Set(parseCsv(publishPlatformsRaw))
  if (!publishPlatforms.has('instagram')) {
    return NextResponse.json({ ok: true, skipped: 'instagram_publish_disabled' })
  }

  const supabase = getAdminClient()
  const hasGenerationMemory = await supportsTrendVideoGenerationMemory(supabase)
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const { count: todayPublished, error: qErr1 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'published')
    .gte('updated_at', startOfDay.toISOString())
  if (qErr1) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`trend-video-publish trend_video_jobs.published_today: ${qErr1.message}`), { tags: { cron: 'trend-video-publish', step: 'db_query_guard' } })
  }

  if ((todayPublished ?? 0) >= (maxJobsPerDay || 1)) {
    return NextResponse.json({ ok: true, skipped: 'daily_publish_cap_reached' })
  }

  const jobSelect: string = hasGenerationMemory
    ? 'id, trend_topic_id, style, angle, hook_title, cover_title, caption, cta_text, image_prompt, motion_prompt, image_provider, video_provider, provider_model, base_image_url, video_url, cover_url, shot_results, generation_memory'
    : 'id, trend_topic_id, style, angle, hook_title, cover_title, caption, cta_text, image_prompt, motion_prompt, image_provider, video_provider, provider_model, base_image_url, video_url, cover_url, shot_results'

  const { data: readyJobsData } = await supabase
    .from('trend_video_jobs')
    .select(jobSelect)
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'ready')
    .order('created_at', { ascending: true })
    .limit(1)
  const { data: stitchFailedJobsData } = await supabase
    .from('trend_video_jobs')
    .select(jobSelect + ', error_code')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'failed')
    .eq('error_code', 'trend_video_stitch_failed')
    .order('created_at', { ascending: true })
    .limit(3)
  const { data: shotFailedJobsData } = await supabase
    .from('trend_video_jobs')
    .select(jobSelect + ', error_code')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'failed')
    .eq('error_code', 'trend_shot_failed')
    .order('created_at', { ascending: true })
    .limit(3)
  const jobs = [
    ...((readyJobsData ?? []) as unknown as Array<Record<string, unknown> & { id: string }>),
    ...((stitchFailedJobsData ?? []) as unknown as Array<Record<string, unknown> & { id: string }>),
    ...((shotFailedJobsData ?? []) as unknown as Array<Record<string, unknown> & { id: string }>),
  ]

  if (!jobs?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_ready_jobs' })
  }

  const job = jobs[0]
  let videoUrl = job.video_url as string | null
  const coverUrl = job.cover_url as string | null
  const generationMemory = hasGenerationMemory && job.generation_memory && typeof job.generation_memory === 'object'
    ? job.generation_memory as Record<string, unknown>
    : {}

  if (!videoUrl && (job.error_code === 'trend_video_stitch_failed' || job.error_code === 'trend_shot_failed')) {
    const recovered = recoverTrendVideoSegments(job.shot_results)
    const clipUrls = recovered.segments.map((segment) => segment.clipUrl).filter((url): url is string => Boolean(url))
    const durationsSec = recovered.segments.map((segment) => segment.durationSec)
    if (recovered.recoverable && clipUrls.length >= 2) {
      videoUrl = await stitchTrendVideoClips({
        jobId: job.id as string,
        clipUrls,
        durationsSec,
      })
      if (videoUrl) {
        generationMemory.recovery = {
          type: job.error_code === 'trend_shot_failed' ? 'shot_fallback' : 'stitch_retry',
          recoveredMissingSegments: recovered.recoveredMissingSegments,
          generatedAt: new Date().toISOString(),
        }
        generationMemory.finalVideo = {
          provider: 'ffmpeg',
          model: 'stitch-trend-video-clips',
          params: { clipUrls, durationsSec },
          generatedAt: new Date().toISOString(),
          url: videoUrl,
        }
        await supabase.from('trend_video_jobs').update(
          withOptionalTrendVideoGenerationMemory({
            status: 'ready',
            video_url: videoUrl,
            error_code: null,
            error_message: null,
          }, hasGenerationMemory, generationMemory)
        ).eq('id', job.id)
      }
    }
  }

  if (!videoUrl) {
    await supabase.from('trend_video_jobs').update({
      status: 'failed',
      error_code: 'missing_video_url',
      error_message: 'job ready without video_url',
    }).eq('id', job.id)
    return NextResponse.json({ ok: false, error: 'missing_video_url' }, { status: 500 })
  }

  const ctaText = (job.cta_text as string | null) || defaultCta
  const captionBase = (job.caption as string).includes(ctaText)
    ? job.caption as string
    : `${job.caption}\n\n${ctaText}`
  const caption = applyMicroVariation(captionBase)
  const quality = runTrendVideoQualityGate({
    topic: job.cover_title as string,
    hookTitle: job.hook_title as string,
    coverTitle: job.cover_title as string,
    caption,
    angle: job.angle as string | null,
    coverUrl,
    generationMemory,
    shotResults: job.shot_results,
  })
  if (!quality.passed) {
    const reason = [...quality.criticalIssues, ...quality.issues].join(' | ')
    await supabase.from('trend_video_jobs').update({
      status: 'failed',
      error_code: 'trend_video_quality_failed',
      error_message: reason,
    }).eq('id', job.id)
    return NextResponse.json({
      ok: false,
      error: 'trend_video_quality_failed',
      quality,
    }, { status: 422 })
  }

  const visualQuality = await analyzeTrendVideoVisualQuality(videoUrl)
  const qualityMemory = generationMemory.quality && typeof generationMemory.quality === 'object'
    ? generationMemory.quality as Record<string, unknown>
    : {}
  generationMemory.quality = {
    ...qualityMemory,
    static: quality,
    visual: {
      ...visualQuality,
      checkedAt: new Date().toISOString(),
    },
  }

  if (!visualQuality.passed) {
    const reason = visualQuality.criticalIssues.join(' | ')
    await supabase.from('trend_video_jobs').update(
      withOptionalTrendVideoGenerationMemory({
        status: 'failed',
        error_code: 'trend_video_visual_quality_failed',
        error_message: reason,
      }, hasGenerationMemory, generationMemory)
    ).eq('id', job.id)
    return NextResponse.json({
      ok: false,
      error: 'trend_video_visual_quality_failed',
      visualQuality,
    }, { status: 422 })
  }

  await supabase.from('trend_video_jobs').update(
    withOptionalTrendVideoGenerationMemory({}, hasGenerationMemory, generationMemory)
  ).eq('id', job.id)

  const giveaway = buildTrendGiveawayPackage({
    jobId: job.id as string,
    trendTopicId: job.trend_topic_id as string | null,
    style: job.style as string,
    angle: job.angle as string,
    hookTitle: job.hook_title as string,
    coverTitle: job.cover_title as string,
    caption,
    ctaText,
    imagePrompt: job.image_prompt as string,
    motionPrompt: job.motion_prompt as string,
    imageProvider: job.image_provider as string | null,
    videoProvider: job.video_provider as string | null,
    providerModel: job.provider_model as string | null,
    baseImageUrl: job.base_image_url as string | null,
    coverUrl,
    videoUrl,
    generationMemory,
    shotResults: Array.isArray(job.shot_results) ? job.shot_results as Array<Record<string, unknown>> : [],
  })
  const giveawayKeyword = typeof giveaway.keyword === 'string' ? giveaway.keyword : 'PROMPT'

  const endcardUrl = await generateTrendCarouselEndcard({
    jobId: job.id as string,
    handle: instagramHandle || '@ai_br_videos',
    keyword: giveawayKeyword,
    title: 'QUER O PROMPT?',
    subtitle: 'Segue o perfil para aprender tudo sobre IA e videos virais.',
  })
  if (!endcardUrl) {
    await supabase.from('trend_video_jobs').update({
      status: 'failed',
      error_code: 'endcard_render_failed',
      error_message: 'trend carousel endcard render/upload failed',
    }).eq('id', job.id)
    return NextResponse.json({ ok: false, error: 'endcard_render_failed' }, { status: 500 })
  }

  const igCreds = await getInstagramCredentials(WORKSPACE_ID)
  if (!igCreds.igUserId || !igCreds.accessToken) {
    return NextResponse.json({ ok: false, error: 'IG credentials missing for workspace' }, { status: 500 })
  }

  const ig = InstagramClient.fromWorkspace(igCreds)
  const result = await ig.publishMixedCarousel(caption, [
    { type: 'image', url: coverUrl || job.base_image_url as string || '' },
    { type: 'video', url: videoUrl },
    { type: 'image', url: endcardUrl },
  ])
  if (!result.success) {
    const qualityUnavailable = result.qualityReview?.outcome === 'unavailable'
    await supabase.from('trend_video_jobs').update({
      status: qualityUnavailable ? 'ready' : 'failed',
      error_code: result.qualityReview?.outcome === 'rejected'
        ? 'quality_gate_rejected'
        : result.qualityReview?.outcome === 'unavailable'
          ? 'quality_gate_unavailable'
          : 'instagram_publish_failed',
      error_message: result.error ?? 'instagram publish failed',
    }).eq('id', job.id)
    if (result.qualityReview?.outcome === 'rejected') {
      await supabase.from('generated_content').insert({
        workspace_id: WORKSPACE_ID,
        curated_content_id: null,
        target_platform: 'instagram',
        target_format: 'carousel',
        content: JSON.stringify({
          type: 'trend_video',
          trend_topic_id: job.trend_topic_id,
          hookTitle: job.hook_title,
          coverTitle: job.cover_title,
          caption,
          videoUrl,
          coverUrl,
        }),
        model_used: String(job.provider_model ?? job.video_provider ?? 'higgsfield'),
        status: 'rejected',
        review_score: result.qualityReview.score,
        review_feedback: result.qualityReview.feedback,
        review_issues: result.qualityReview.issues,
        metadata: { final_quality_review: result.qualityReview, trend_video_job_id: job.id },
      })
    }
    return NextResponse.json({ ok: false, error: result.error }, { status: qualityUnavailable ? 503 : 500 })
  }

  const { data: inserted, error: insertError } = await supabase
    .from('generated_content')
    .insert({
      workspace_id: WORKSPACE_ID,
      curated_content_id: null,
      target_platform: 'instagram',
      target_format: 'carousel',
      content: JSON.stringify({
        type: 'trend_video',
        trend_topic_id: job.trend_topic_id,
        hookTitle: job.hook_title,
        coverTitle: job.cover_title,
        style: job.style,
        angle: job.angle,
        caption,
        videoUrl,
        coverUrl,
        generation: {
          imageProvider: job.image_provider,
          videoProvider: job.video_provider,
          providerModel: job.provider_model,
          baseImageUrl: job.base_image_url,
          generationMemory,
          shotResults: job.shot_results,
        },
        carousel: {
          items: [
            { type: 'image', url: coverUrl || job.base_image_url },
            { type: 'video', url: videoUrl },
            { type: 'image', url: endcardUrl },
          ],
        },
        giveaway,
      }),
      model_used: String(job.provider_model ?? job.video_provider ?? 'higgsfield'),
      status: 'published',
      review_score: result.qualityReview?.score ?? null,
      review_feedback: result.qualityReview?.feedback ?? null,
      review_issues: result.qualityReview?.issues ?? [],
      metadata: result.qualityReview ? { final_quality_review: result.qualityReview, trend_video_job_id: job.id } : null,
      published_id: result.postId ?? null,
      published_url: result.postUrl ?? null,
      published_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (insertError) {
    return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
  }

  await supabase.from('trend_video_jobs').update({
    status: 'published',
    published_generated_content_id: inserted.id,
    error_code: null,
    error_message: null,
  }).eq('id', job.id)

  await supabase.from('br_trend_topics').update({ status: 'processed' }).eq('id', job.trend_topic_id as string)

  return NextResponse.json({
    ok: true,
    published: {
      jobId: job.id,
      generatedContentId: inserted.id,
      postId: result.postId,
      postUrl: result.postUrl,
    },
  })
}
