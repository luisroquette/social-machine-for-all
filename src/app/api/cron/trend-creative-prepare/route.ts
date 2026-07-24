import * as Sentry from '@sentry/nextjs'
import { WORKSPACE_ID } from '@/lib/config/constants'
export const maxDuration = 90

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getNumericVariable, getVariable } from '@/lib/settings/load-settings'
import { generateTrendEditorial, generateTrendVideoMotion } from '@/lib/trends/trend-creative'
import { applyLearnedStyleRotation, buildTrendLearningPack, classifyTrendVideoModelMode, scoreAdaptiveTrendTopic } from '@/lib/trends/trend-learning'
import { refineTrendTopic } from '@/lib/trends/trend-topic-refinement'
import type { TablesInsert } from '@/lib/supabase/database.types'
import {
  supportsTrendVideoGenerationMemory,
  withOptionalTrendVideoGenerationMemory,
} from '@/lib/trends/trend-video-schema'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

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

  const [enabledRaw, maxTopicsPerRun, maxJobsPerDay, styleRotationRaw, defaultCta, model, shotsPerVideo, shotDurationSec] = await Promise.all([
    getVariable(WORKSPACE_ID, 'trend_video_enabled'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_max_topics_per_run'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_max_jobs_per_day'),
    getVariable(WORKSPACE_ID, 'trend_video_style_rotation'),
    getVariable(WORKSPACE_ID, 'trend_video_default_cta'),
    getVariable(WORKSPACE_ID, 'trend_video_creative_model'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_shots_per_video'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_default_duration_sec'),
  ])

  if (!isEnabled(enabledRaw)) {
    return NextResponse.json({ ok: true, skipped: 'trend_video_disabled' })
  }

  const supabase = getAdminClient()
  const hasGenerationMemory = await supportsTrendVideoGenerationMemory(supabase)
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)

  const { count: todayCount, error: qErr1 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .gte('created_at', startOfDay.toISOString())
  if (qErr1) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`trend-creative-prepare trend_video_jobs.today: ${qErr1.message}`), { tags: { cron: 'trend-creative-prepare', step: 'db_query_guard' } })
  }

  if ((todayCount ?? 0) >= (maxJobsPerDay || 1)) {
    return NextResponse.json({ ok: true, skipped: 'daily_cap_reached', todayCount })
  }

  const { data: topics } = await supabase
    .from('br_trend_topics')
    .select('id, topic, category, related_news, trend_score, raw_payload')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'new')
    .eq('safety_status', 'approved')
    .order('trend_score', { ascending: false })
    .limit(maxTopicsPerRun || 6)

  if (!topics?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_approved_topics' })
  }

  const topicIds = topics.map((topic) => topic.id)
  const { data: existingJobs } = await supabase
    .from('trend_video_jobs')
    .select('trend_topic_id, status')
    .in('trend_topic_id', topicIds)

  const existingByTopic = new Set(
    (existingJobs ?? [])
      .filter((job: { status: string }) => job.status !== 'failed')
      .map((job: { trend_topic_id: string }) => job.trend_topic_id)
  )

  const styleRotation = parseCsv(styleRotationRaw)
  const topicCategories = [...new Set(topics.map((topic) => (topic.category as string) || 'general'))]
  const historicalWindow = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
  const { data: styleStats } = await supabase
    .from('trend_style_stats')
    .select('style, hook_pattern, topic_category, posts_count, avg_reach, avg_likes, avg_saves, avg_shares, avg_prompt_requests, delivery_rate')
    .eq('workspace_id', WORKSPACE_ID)
    .in('topic_category', topicCategories)
  const publishedJobSelect: string = hasGenerationMemory
    ? 'trend_topic_id, provider_model, video_provider, generation_memory'
    : 'trend_topic_id, provider_model, video_provider'

  const { data: publishedJobsData } = await supabase
    .from('trend_video_jobs')
    .select(publishedJobSelect)
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'published')
    .gte('updated_at', historicalWindow)
    .order('updated_at', { ascending: false })
    .limit(80)
  const publishedJobs = (publishedJobsData ?? []) as unknown as Array<Record<string, unknown>>
  const historicalTopicIds = [...new Set(publishedJobs.map((job) => job.trend_topic_id).filter((id): id is string => Boolean(id)))]
  const { data: historicalTopics } = historicalTopicIds.length
    ? await supabase
      .from('br_trend_topics')
      .select('id, category')
      .in('id', historicalTopicIds)
    : { data: [] }
  const topicCategoryById = new Map((historicalTopics ?? []).map((item) => [item.id, (item.category as string) || 'general']))
  const historicalDecisions = publishedJobs.map((job) => {
    const generationMemory = asRecord(job.generation_memory)
    const planning = asRecord(generationMemory?.planning)
    const editorialTemplate = asRecord(planning?.editorialTemplate)
    const learning = asRecord(planning?.learning)
    const analytics = asRecord(generationMemory?.analytics)
    const instagram = asRecord(analytics?.instagram)
    const engagement = asRecord(instagram?.engagement)
    const giveaway = asRecord(instagram?.giveawayFunnel)
    const providerModel = typeof job.provider_model === 'string' ? job.provider_model : null

    return {
      topicCategory: topicCategoryById.get(job.trend_topic_id as string) || 'general',
      editorialTemplateId: typeof editorialTemplate?.id === 'string' ? editorialTemplate.id : null,
      editorialTemplateLabel: typeof editorialTemplate?.label === 'string' ? editorialTemplate.label : null,
      videoProvider: typeof job.video_provider === 'string' ? job.video_provider : null,
      providerModel,
      generationMode:
        typeof learning?.preferredGenerationMode === 'string'
          ? learning.preferredGenerationMode
          : classifyTrendVideoModelMode(providerModel),
      reach: toNumber(engagement?.reach),
      likes: toNumber(engagement?.likes),
      saves: toNumber(engagement?.saved),
      shares: toNumber(engagement?.shares),
      promptRequests: toNumber(giveaway?.promptRequests),
      deliveryRate: toNumber(giveaway?.deliveryRate),
    }
  })
  const created: Array<{ topic: string; style: string; editorialTemplate: string }> = []
  const rankedTopics = topics
    .map((topic) => {
      const rawPayload = asRecord(topic.raw_payload)
      const breakdown = asRecord(rawPayload?.score_breakdown)
      const category = ((topic.category as string) || 'general')
      const learning = buildTrendLearningPack(
        (styleStats ?? []) as Array<{
          style: string | null
          hook_pattern: string | null
          topic_category: string | null
          posts_count: number | null
          avg_reach: number | null
          avg_likes: number | null
          avg_saves: number | null
          avg_shares: number | null
          avg_prompt_requests: number | null
          delivery_rate: number | null
        }>,
        historicalDecisions,
        category,
      )

      return {
        ...topic,
        learning,
        adaptiveTrendScore: scoreAdaptiveTrendTopic({
          topic: topic.topic as string,
          category,
          relatedText: Array.isArray(topic.related_news)
            ? (topic.related_news as Array<{ title?: string; source?: string }>).map((item) => `${item.title ?? ''} ${item.source ?? ''}`.trim()).join(' ')
            : '',
          baseTrendScore: toNumber(topic.trend_score),
          visualPotential: toNumber(breakdown?.visualPotential),
          emotionalPotential: toNumber(breakdown?.emotionalPotential),
          shortViralFit: toNumber(breakdown?.shortViralFit),
          learning,
        }),
      }
    })
    .sort((a, b) => b.adaptiveTrendScore - a.adaptiveTrendScore)

  for (const topic of rankedTopics) {
    if (existingByTopic.has(topic.id)) continue
    if ((todayCount ?? 0) + created.length >= (maxJobsPerDay || 1)) break
    const learning = topic.learning
    const relatedNews = Array.isArray(topic.related_news) ? topic.related_news as Array<{ title: string; source: string }> : []
    const topicRefinement = refineTrendTopic({
      topic: topic.topic as string,
      relatedNews,
    })

    // Editorial (capa/legenda) e motion (shots de video) sao geracoes de LLM independentes,
    // nenhuma alimenta a outra — rodam em paralelo.
    const [editorial, motion] = await Promise.all([
      generateTrendEditorial({
        topic: topicRefinement.editorialTopic,
        category: (topic.category as string) || 'general',
        relatedNews,
        defaultCta,
        model: model || 'deepseek-chat',
        learning: {
          preferredHookPattern: learning.preferredHookPattern,
          preferredEditorialTemplateId: learning.preferredEditorialTemplateId,
          reasons: learning.topPreference?.reasons ?? [],
        },
      }),
      generateTrendVideoMotion({
        topic: topicRefinement.editorialTopic,
        category: (topic.category as string) || 'general',
        styleRotation: applyLearnedStyleRotation(styleRotation, learning.topStyles),
        model: model || 'deepseek-chat',
        shotsPerVideo: shotsPerVideo || 5,
        shotDurationSec: shotDurationSec || 3,
        learning: {
          preferredStyle: learning.preferredStyle,
          preferredEditorialTemplateId: learning.preferredEditorialTemplateId,
          preferredVideoModel: learning.preferredVideoModel,
          topVideoReasons: learning.topVideoPreference?.reasons ?? [],
        },
      }),
    ])
    const masterMotionPrompt = motion.shots[0]?.motionPrompt ?? ''

    const planningMemory = {
      planning: {
        createdAt: new Date().toISOString(),
        editorialTemplate: {
          id: editorial.editorialTemplateId,
          label: editorial.editorialTemplateLabel,
          angle: editorial.angle,
        },
        hookCandidates: editorial.hookCandidates,
        coverCandidates: editorial.coverCandidates,
        coverPrompt: editorial.imagePrompt,
        masterMotionPrompt,
        style: motion.style,
        angle: editorial.angle,
        topicRefinement,
        learning,
        learningDecision: {
          rankedTopicScore: topic.adaptiveTrendScore,
          preferredStyle: learning.preferredStyle,
          preferredHookPattern: learning.preferredHookPattern,
          preferredEditorialTemplateId: learning.preferredEditorialTemplateId,
          preferredEditorialTemplateLabel: learning.preferredEditorialTemplateLabel,
          preferredVideoProvider: learning.preferredVideoProvider,
          preferredVideoModel: learning.preferredVideoModel,
          preferredGenerationMode: learning.preferredGenerationMode,
          topStyleReasons: learning.topPreference?.reasons ?? [],
          topVideoReasons: learning.topVideoPreference?.reasons ?? [],
          topVideoPreferences: learning.topVideoPreferences,
        },
        adaptiveTrendScore: topic.adaptiveTrendScore,
        baseTrendScore: toNumber(topic.trend_score),
        shots: motion.shots,
      },
    }

    const { error } = await supabase.from('trend_video_jobs').insert(withOptionalTrendVideoGenerationMemory({
      workspace_id: WORKSPACE_ID,
      trend_topic_id: topic.id,
      style: motion.style,
      angle: editorial.angle,
      hook_title: editorial.hookTitle,
      cover_title: editorial.coverTitle,
      caption: editorial.caption,
      cta_text: editorial.ctaText,
      image_prompt: editorial.imagePrompt,
      motion_prompt: masterMotionPrompt,
      shot_plan: motion.shots,
      shot_results: motion.shots.map((shot, index) => ({
        ...shot,
        index,
        status: 'pending',
        clipUrl: null,
        providerJobId: null,
        videoGeneration: null,
        error: null,
      })),
      video_provider: learning.preferredVideoProvider || 'higgsfield',
      provider_model: learning.preferredVideoModel || null,
      status: 'creative_ready',
    }, hasGenerationMemory, planningMemory) as unknown as TablesInsert<'trend_video_jobs'>)

    if (!error) {
      created.push({ topic: topicRefinement.editorialTopic, style: motion.style, editorialTemplate: editorial.editorialTemplateLabel })
      await supabase.from('br_trend_topics').update({ status: 'queued' }).eq('id', topic.id)
    }
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    jobs: created,
  })
}
