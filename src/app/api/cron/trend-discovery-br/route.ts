import { WORKSPACE_ID } from '@/lib/config/constants'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getNumericVariable, getVariable } from '@/lib/settings/load-settings'
import { fetchGoogleTrendsRss } from '@/lib/trends/google-trends'
import { scoreTrendBrazilAiFit } from '@/lib/trends/trend-market-fit'
import { evaluateTrendSafety } from '@/lib/trends/trend-safety'
import { matchesTrendFocus } from '@/lib/trends/trend-topic-focus'
import { evaluateTrendTopicSeed } from '@/lib/trends/trend-topic-seed'
import { scoreTrendTopicDetailed } from '@/lib/trends/trend-scoring'
import { buildTrendLearningPack, classifyTrendVideoModelMode, scoreAdaptiveTrendTopic } from '@/lib/trends/trend-learning'
import { supportsTrendVideoGenerationMemory } from '@/lib/trends/trend-video-schema'
import { fetchXTrendingTopics } from '@/lib/trends/x-trends'
import type { TablesInsert } from '@/lib/supabase/database.types'

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

  const [enabledRaw, sourcesRaw, countryCode, maxTopicsPerRun, blockedKeywords, allowedCategoriesRaw, requiredKeywordsRaw] = await Promise.all([
    getVariable(WORKSPACE_ID, 'trend_video_enabled'),
    getVariable(WORKSPACE_ID, 'trend_video_sources'),
    getVariable(WORKSPACE_ID, 'trend_video_country_code'),
    getNumericVariable(WORKSPACE_ID, 'trend_video_max_topics_per_run'),
    getVariable(WORKSPACE_ID, 'trend_video_blocked_keywords'),
    getVariable(WORKSPACE_ID, 'trend_video_allowed_categories'),
    getVariable(WORKSPACE_ID, 'trend_video_required_keywords'),
  ])

  if (!isEnabled(enabledRaw)) {
    return NextResponse.json({ ok: true, skipped: 'trend_video_disabled' })
  }

  const sources = new Set(parseCsv(sourcesRaw))
  const allowedCategories = new Set(parseCsv(allowedCategoriesRaw))
  if (!sources.has('google_trends') && !sources.has('x_trending')) {
    return NextResponse.json({ ok: true, skipped: 'no_supported_sources_enabled' })
  }

  const country = countryCode || 'BR'
  const [googleTopics, xTopics] = await Promise.all([
    sources.has('google_trends') ? fetchGoogleTrendsRss({ countryCode: country }) : Promise.resolve([]),
    sources.has('x_trending') ? fetchXTrendingTopics({ countryCode: country }) : Promise.resolve([]),
  ])

  const topics = [...googleTopics, ...xTopics]
  if (!topics.length) {
    return NextResponse.json({ ok: true, skipped: 'no_topics_found' })
  }

  const supabase = getAdminClient()
  const hasGenerationMemory = await supportsTrendVideoGenerationMemory(supabase)
  const historicalWindow = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString()
  const dedupSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const activeSources = Array.from(sources).filter((source) => source === 'google_trends' || source === 'x_trending')
  const { data: existing } = await supabase
    .from('br_trend_topics')
    .select('normalized_topic, source')
    .eq('workspace_id', WORKSPACE_ID)
    .in('source', activeSources)
    .gte('detected_at', dedupSince)
  const topicCategories = [...new Set(topics.map((topic) => topic.category))]
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

  const existingTopics = new Set((existing ?? []).map((row: { normalized_topic: string; source: string }) => `${row.source}:${row.normalized_topic}`))
  const curatedTopics = topics
    .filter((topic) => !existingTopics.has(`${topic.source}:${topic.normalizedTopic}`))
    .filter((topic) => allowedCategories.size === 0 || allowedCategories.has(topic.category))
    .filter((topic) => {
      const relatedText = topic.relatedNews.map((news) => `${news.title} ${news.source}`).join(' ')
      const topicSeed = evaluateTrendTopicSeed({
        topic: topic.topic,
        relatedText,
      })
      if (!topicSeed.approved) return false

      const focus = matchesTrendFocus({
        topic: topic.topic,
        relatedText,
        requiredKeywordsCsv: requiredKeywordsRaw,
      })
      if (!focus.matches) return false

      const marketFit = scoreTrendBrazilAiFit({
        topic: topic.topic,
        source: topic.source,
        relatedNews: topic.relatedNews,
        countryCode: topic.countryCode,
      })

      return marketFit.approved
    })

  const focusRejected = topics.length - curatedTopics.length
  const rows = curatedTopics
    .map((topic) => {
      const relatedText = topic.relatedNews.map((news) => `${news.title} ${news.source}`).join(' ')
      const safety = evaluateTrendSafety({
        topic: topic.topic,
        category: topic.category,
        relatedText,
        blockedKeywordsCsv: blockedKeywords,
      })
      const marketFit = scoreTrendBrazilAiFit({
        topic: topic.topic,
        source: topic.source,
        relatedNews: topic.relatedNews,
        countryCode: topic.countryCode,
      })
      const trendScore = scoreTrendTopicDetailed({
        topic: topic.topic,
        category: topic.category,
        volumeScore: topic.volumeScore,
        relatedNewsCount: topic.relatedNews.length,
        relatedText,
        publishedAt: topic.publishedAt,
      })
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
        topic.category,
      )
      const adaptiveTrendScore = scoreAdaptiveTrendTopic({
        topic: topic.topic,
        category: topic.category,
        relatedText,
        baseTrendScore: trendScore.score + marketFit.score,
        visualPotential: trendScore.breakdown.visualPotential,
        emotionalPotential: trendScore.breakdown.emotionalPotential,
        shortViralFit: trendScore.breakdown.shortViralFit,
        learning,
      })

      return {
        workspace_id: WORKSPACE_ID,
        source: topic.source,
        country_code: topic.countryCode,
        region: 'Brazil',
        topic: topic.topic,
        normalized_topic: topic.normalizedTopic,
        category: topic.category,
        volume_label: topic.volumeLabel,
        volume_score: topic.volumeScore,
        rank_position: 0,
        related_news: topic.relatedNews,
        raw_payload: {
          ...topic.rawPayload,
          market_fit_score: marketFit.score,
          market_fit: marketFit,
          base_trend_score: trendScore.score,
          adaptive_trend_score: adaptiveTrendScore,
          score_breakdown: trendScore.breakdown,
          learning_summary: {
            preferredStyle: learning.preferredStyle,
            preferredHookPattern: learning.preferredHookPattern,
            preferredEditorialTemplateId: learning.preferredEditorialTemplateId,
            preferredVideoModel: learning.preferredVideoModel,
            preferredGenerationMode: learning.preferredGenerationMode,
          },
        },
        safety_status: safety.status,
        safety_flags: safety.flags,
        trend_score: Math.max(0, Math.min(100, trendScore.score + marketFit.score)),
        status: safety.status === 'approved' ? 'new' : 'discarded',
        detected_at: topic.publishedAt ?? new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }
    })
    .sort((a, b) => {
      const adaptiveA = toNumber(asRecord(a.raw_payload)?.adaptive_trend_score)
      const adaptiveB = toNumber(asRecord(b.raw_payload)?.adaptive_trend_score)
      return adaptiveB - adaptiveA
    })
    .slice(0, Math.max(1, maxTopicsPerRun || 6))
    .map((row, index) => ({ ...row, rank_position: index + 1 }))

  if (!rows.length) {
    return NextResponse.json({
      ok: true,
      skipped: focusRejected > 0 ? 'all_topics_filtered_by_curation' : 'all_topics_deduped',
      focusRejected,
    })
  }

  const { error } = await supabase.from('br_trend_topics').insert(rows as unknown as TablesInsert<'br_trend_topics'>[])
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    inserted: rows.length,
    approved: rows.filter((row) => row.safety_status === 'approved').length,
    blocked: rows.filter((row) => row.safety_status === 'blocked').length,
    focusRejected,
    topics: rows.map((row) => ({
      topic: row.topic,
      category: row.category,
      status: row.safety_status,
      trend_score: row.trend_score,
      market_fit_score: toNumber(asRecord(row.raw_payload)?.market_fit_score),
      adaptive_trend_score: toNumber(asRecord(row.raw_payload)?.adaptive_trend_score),
    })),
  })
}
