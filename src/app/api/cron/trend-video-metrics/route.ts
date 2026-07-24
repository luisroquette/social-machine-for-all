import { WORKSPACE_ID, INSTAGRAM_API_BASE } from '@/lib/config/constants'
export const maxDuration = 90

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { fetchFollowerCount } from '@/lib/platforms/instagram/follower-count'
import { fetchInstagramMediaInsights } from '@/lib/platforms/instagram/media-insights'
import { buildEngagementUpdate } from '@/lib/eval/engagement-metrics'
import {
  buildTrendStyleStatRows,
  computeFollowDelta,
  normalizeTrendMetrics,
  summarizeGiveawayFunnel,
} from '@/lib/trends/trend-video-analytics'
import type { Json, TablesInsert } from '@/lib/supabase/database.types'
import {
  supportsTrendVideoGenerationMemory,
  withOptionalTrendVideoGenerationMemory,
} from '@/lib/trends/trend-video-schema'

interface TrendVideoJobRow {
  id: string
  trend_topic_id: string | null
  style: string
  hook_title: string
  published_generated_content_id: string | null
  generation_memory: Record<string, unknown> | null
}

interface GeneratedContentRow {
  id: string
  published_id: string | null
  published_at: string | null
  engagement_metrics: Record<string, unknown> | null
}

interface TopicRow {
  id: string
  category: string | null
}

interface GiveawayLeadRow {
  generated_content_id: string | null
  status: string | null
  replied_at: string | null
  dm_received_at: string | null
  qualified_at: string | null
  delivered_at: string | null
}

interface SnapshotRow {
  snapshot_date: string
  followers_count: number | null
}

async function upsertFollowerSnapshot() {
  try {
    const { accessToken, igUserId } = await getInstagramCredentials(WORKSPACE_ID)
    if (!accessToken || !igUserId) return null

    const snapshot = await fetchFollowerCount(INSTAGRAM_API_BASE, igUserId, accessToken)
    if (!snapshot) return null

    const supabase = getAdminClient()
    await supabase.from('profile_metrics_snapshots').upsert({
      workspace_id: WORKSPACE_ID,
      snapshot_date: new Date().toISOString().slice(0, 10),
      followers_count: snapshot.followersCount,
      media_count: snapshot.mediaCount,
    }, {
      onConflict: 'workspace_id,snapshot_date',
    })

    return snapshot.followersCount
  } catch {
    return null
  }
}

async function loadFollowerSnapshots(supabase: ReturnType<typeof getAdminClient>, sinceDate: string): Promise<SnapshotRow[]> {
  const { data, error } = await supabase
    .from('profile_metrics_snapshots')
    .select('snapshot_date, followers_count')
    .eq('workspace_id', WORKSPACE_ID)
    .gte('snapshot_date', sinceDate)
    .order('snapshot_date', { ascending: true })

  if (error || !data) {
    return []
  }

  return data as SnapshotRow[]
}

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()
  const hasGenerationMemory = await supportsTrendVideoGenerationMemory(supabase)
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
  const sinceIso = since.toISOString()
  const sinceDate = sinceIso.slice(0, 10)

  await upsertFollowerSnapshot()

  const jobSelect: string = hasGenerationMemory
    ? 'id, trend_topic_id, style, hook_title, published_generated_content_id, generation_memory'
    : 'id, trend_topic_id, style, hook_title, published_generated_content_id'

  const { data: jobsData } = await supabase
    .from('trend_video_jobs')
    .select(jobSelect)
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'published')
    .gte('updated_at', sinceIso)
    .not('published_generated_content_id', 'is', null)
  const jobs = jobsData ?? []

  if (!jobs?.length) {
    return NextResponse.json({ ok: true, skipped: 'no_published_jobs' })
  }

  const typedJobs = jobs as unknown as TrendVideoJobRow[]
  const generatedIds = typedJobs
    .map((job) => job.published_generated_content_id)
    .filter((value): value is string => Boolean(value))
  const topicIds = typedJobs
    .map((job) => job.trend_topic_id)
    .filter((value): value is string => Boolean(value))

  const [{ data: contents }, { data: topics }, { data: leads }, snapshots] = await Promise.all([
    supabase
      .from('generated_content')
      .select('id, published_id, published_at, engagement_metrics')
      .in('id', generatedIds),
    supabase
      .from('br_trend_topics')
      .select('id, category')
      .in('id', topicIds),
    supabase
      .from('instagram_giveaway_leads')
      .select('generated_content_id, status, replied_at, dm_received_at, qualified_at, delivered_at')
      .in('generated_content_id', generatedIds),
    loadFollowerSnapshots(supabase, sinceDate),
  ])

  const contentById = new Map((contents ?? []).map((item) => [item.id, item as GeneratedContentRow]))
  const topicById = new Map((topics ?? []).map((item) => [item.id, (item as TopicRow).category ?? 'general']))
  const leadsByContentId = new Map<string, GiveawayLeadRow[]>()

  for (const lead of (leads ?? []) as GiveawayLeadRow[]) {
    if (!lead.generated_content_id) continue
    const current = leadsByContentId.get(lead.generated_content_id) ?? []
    current.push(lead)
    leadsByContentId.set(lead.generated_content_id, current)
  }

  const { accessToken } = await getInstagramCredentials(WORKSPACE_ID)
  if (!accessToken) {
    return NextResponse.json({ error: 'No IG token for workspace' }, { status: 500 })
  }

  const statsInputs: Array<{
    style: string
    hookTitle: string
    topicCategory: string
    metrics: ReturnType<typeof normalizeTrendMetrics>
    giveaway: ReturnType<typeof summarizeGiveawayFunnel>
    followDelta: number | null
  }> = []

  let syncedContents = 0
  let insightsFailures = 0

  for (const job of typedJobs) {
    if (!job.published_generated_content_id) continue

    const content = contentById.get(job.published_generated_content_id)
    if (!content) continue

    let normalizedMetrics = normalizeTrendMetrics(content.engagement_metrics)
    try {
      if (content.published_id) {
        const insights = await fetchInstagramMediaInsights({
          apiBase: INSTAGRAM_API_BASE,
          mediaId: content.published_id,
          accessToken,
        })

        normalizedMetrics = normalizeTrendMetrics({
          ...insights.metrics,
          views: insights.metrics.views ?? insights.metrics.total_views ?? insights.metrics.impressions ?? 0,
          total_views: insights.metrics.total_views ?? insights.metrics.views ?? 0,
          impressions: insights.metrics.impressions ?? 0,
          fetched_at: new Date().toISOString(),
        })
      }
    } catch {
      insightsFailures += 1
    }

    const giveaway = summarizeGiveawayFunnel(
      leadsByContentId.get(content.id) ?? [],
      normalizedMetrics.comments,
    )
    const followDelta = computeFollowDelta(snapshots, content.published_at)

    const baseEngagement = {
      reach: normalizedMetrics.reach,
      likes: normalizedMetrics.likes,
      comments: normalizedMetrics.comments,
      saved: normalizedMetrics.saved,
      shares: normalizedMetrics.shares,
      total_interactions: normalizedMetrics.totalInteractions,
      avg_watch_time_ms: normalizedMetrics.avgWatchTimeMs,
      total_view_time_ms: normalizedMetrics.totalViewTimeMs,
      fetched_at: normalizedMetrics.fetchedAt ?? new Date().toISOString(),
    }

    const engagementUpdate = buildEngagementUpdate(baseEngagement)
    const enrichedMetrics = {
      ...engagementUpdate.engagement_metrics,
      views: normalizedMetrics.views,
      impressions: normalizedMetrics.impressions,
      giveaway_funnel: giveaway,
      follow_delta: followDelta,
      target_format: 'carousel',
    }

    await supabase
      .from('generated_content')
      .update({
        ...engagementUpdate,
        engagement_metrics: enrichedMetrics as unknown as Json,
      })
      .eq('id', content.id)

    const nextGenerationMemory = {
      ...(job.generation_memory ?? {}),
      analytics: {
        ...(job.generation_memory?.analytics && typeof job.generation_memory.analytics === 'object'
          ? job.generation_memory.analytics as Record<string, unknown>
          : {}),
        instagram: {
          engagement: enrichedMetrics,
          giveawayFunnel: giveaway,
          followDelta,
          syncedAt: new Date().toISOString(),
        },
      },
    }

    await supabase
      .from('trend_video_jobs')
      .update(withOptionalTrendVideoGenerationMemory({}, hasGenerationMemory, nextGenerationMemory))
      .eq('id', job.id)

    syncedContents += 1
    statsInputs.push({
      style: job.style,
      hookTitle: job.hook_title,
      topicCategory: topicById.get(job.trend_topic_id ?? '') ?? 'general',
      metrics: normalizedMetrics,
      giveaway,
      followDelta,
    })
  }

  const rows = buildTrendStyleStatRows(WORKSPACE_ID, statsInputs)
  if (rows.length) {
    await supabase.from('trend_style_stats').upsert(rows as TablesInsert<'trend_style_stats'>[], {
      onConflict: 'workspace_id,style,hook_pattern,topic_category',
    })
  }

  return NextResponse.json({
    ok: true,
    updated: rows.length,
    syncedContents,
    insightsFailures,
  })
}
