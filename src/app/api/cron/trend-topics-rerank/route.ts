import { WORKSPACE_ID } from '@/lib/config/constants'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable } from '@/lib/settings/load-settings'
import { buildTrendLearningPack, classifyTrendVideoModelMode, scoreAdaptiveTrendTopic } from '@/lib/trends/trend-learning'
import { supportsTrendVideoGenerationMemory } from '@/lib/trends/trend-video-schema'

type JsonObject = Record<string, unknown>

function asRecord(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
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

function isEnabled(value: string): boolean {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const enabledRaw = await getVariable(WORKSPACE_ID, 'trend_video_enabled')
  if (!isEnabled(enabledRaw)) {
    return NextResponse.json({ ok: true, skipped: 'trend_video_disabled' })
  }

  const supabase = getAdminClient()
  const hasGenerationMemory = await supportsTrendVideoGenerationMemory(supabase)
  const historicalWindow = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
  const nowIso = new Date().toISOString()
  const publishedJobSelect: string = hasGenerationMemory
    ? 'trend_topic_id, provider_model, video_provider, generation_memory'
    : 'trend_topic_id, provider_model, video_provider'

  const [{ data: topics }, { data: styleStats }, { data: publishedJobsData }] = await Promise.all([
    supabase
      .from('br_trend_topics')
      .select('id, topic, category, related_news, trend_score, raw_payload')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'new')
      .eq('safety_status', 'approved')
      .gte('expires_at', nowIso)
      .order('detected_at', { ascending: false })
      .limit(100),
    supabase
      .from('trend_style_stats')
      .select('style, hook_pattern, topic_category, posts_count, avg_reach, avg_likes, avg_saves, avg_shares, avg_prompt_requests, delivery_rate')
      .eq('workspace_id', WORKSPACE_ID),
    supabase
      .from('trend_video_jobs')
      .select(publishedJobSelect)
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'published')
      .gte('updated_at', historicalWindow)
      .order('updated_at', { ascending: false })
      .limit(80),
  ])

  if (!topics?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_new_topics_to_rerank' })
  }

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

  const rankedTopics = topics
    .map((topic) => {
      const rawPayload = asRecord(topic.raw_payload)
      const breakdown = asRecord(rawPayload?.score_breakdown)
      const category = (topic.category as string) || 'general'
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
      const adaptiveTrendScore = scoreAdaptiveTrendTopic({
        topic: topic.topic as string,
        category,
        relatedText: Array.isArray(topic.related_news)
          ? (topic.related_news as Array<{ title?: string; source?: string }>).map((item) => `${item.title ?? ''} ${item.source ?? ''}`.trim()).join(' ')
          : '',
        baseTrendScore: toNumber(rawPayload?.base_trend_score ?? topic.trend_score),
        visualPotential: toNumber(breakdown?.visualPotential),
        emotionalPotential: toNumber(breakdown?.emotionalPotential),
        shortViralFit: toNumber(breakdown?.shortViralFit),
        learning,
      })

      return {
        ...topic,
        rawPayload,
        learning,
        adaptiveTrendScore,
      }
    })
    .sort((a, b) => b.adaptiveTrendScore - a.adaptiveTrendScore)

  for (const [index, topic] of rankedTopics.entries()) {
    await supabase
      .from('br_trend_topics')
      .update({
        rank_position: index + 1,
        raw_payload: {
          ...(topic.rawPayload ?? {}),
          base_trend_score: toNumber(topic.rawPayload?.base_trend_score ?? topic.trend_score),
          adaptive_trend_score: topic.adaptiveTrendScore,
          learning_summary: {
            preferredStyle: topic.learning.preferredStyle,
            preferredHookPattern: topic.learning.preferredHookPattern,
            preferredEditorialTemplateId: topic.learning.preferredEditorialTemplateId,
            preferredVideoModel: topic.learning.preferredVideoModel,
            preferredGenerationMode: topic.learning.preferredGenerationMode,
          },
        },
      })
      .eq('id', topic.id)
  }

  return NextResponse.json({
    ok: true,
    reranked: rankedTopics.length,
    topics: rankedTopics.slice(0, 10).map((topic, index) => ({
      id: topic.id,
      topic: topic.topic,
      category: topic.category,
      rank_position: index + 1,
      base_trend_score: toNumber(topic.rawPayload?.base_trend_score ?? topic.trend_score),
      adaptive_trend_score: topic.adaptiveTrendScore,
    })),
  })
}
