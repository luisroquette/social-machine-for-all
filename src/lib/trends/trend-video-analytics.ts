export interface TrendGiveawayLeadLike {
  status?: string | null
  replied_at?: string | null
  dm_received_at?: string | null
  qualified_at?: string | null
  delivered_at?: string | null
}

export interface GiveawayFunnelSummary {
  promptRequests: number
  commentReplies: number
  dmReceived: number
  qualified: number
  delivered: number
  failed: number
  promptRequestRate: number
  dmConversionRate: number
  deliveryRate: number
}

export interface ProfileMetricsSnapshotLike {
  snapshot_date: string
  followers_count: number | null
}

export interface TrendNormalizedMetrics {
  views: number
  impressions: number
  reach: number
  likes: number
  comments: number
  saved: number
  shares: number
  totalInteractions: number
  avgWatchTimeMs: number
  totalViewTimeMs: number
  fetchedAt: string | null
}

export interface TrendAnalyticsRowInput {
  style: string
  hookTitle: string
  topicCategory: string
  metrics: TrendNormalizedMetrics
  giveaway: GiveawayFunnelSummary
  followDelta: number | null
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function hookPattern(hookTitle: string): string {
  return hookTitle.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase()
}

export function summarizeGiveawayFunnel(
  leads: TrendGiveawayLeadLike[],
  totalComments: number,
): GiveawayFunnelSummary {
  const summary = {
    promptRequests: leads.length,
    commentReplies: 0,
    dmReceived: 0,
    qualified: 0,
    delivered: 0,
    failed: 0,
    promptRequestRate: 0,
    dmConversionRate: 0,
    deliveryRate: 0,
  }

  for (const lead of leads) {
    if (lead.replied_at || lead.status === 'comment_replied') summary.commentReplies += 1
    if (lead.dm_received_at) summary.dmReceived += 1
    if (lead.qualified_at || lead.status === 'qualified') summary.qualified += 1
    if (lead.delivered_at || lead.status === 'delivered') summary.delivered += 1
    if (lead.status === 'failed') summary.failed += 1
  }

  summary.promptRequestRate = totalComments > 0
    ? Math.round((summary.promptRequests / totalComments) * 10000) / 100
    : 0
  summary.dmConversionRate = summary.promptRequests > 0
    ? Math.round((summary.dmReceived / summary.promptRequests) * 10000) / 100
    : 0
  summary.deliveryRate = summary.promptRequests > 0
    ? Math.round((summary.delivered / summary.promptRequests) * 10000) / 100
    : 0

  return summary
}

export function computeFollowDelta(
  snapshots: ProfileMetricsSnapshotLike[],
  publishedAt: string | null,
): number | null {
  if (!publishedAt || !snapshots.length) return null

  const publishedDate = publishedAt.slice(0, 10)
  const normalized = snapshots
    .filter((snapshot) => typeof snapshot.snapshot_date === 'string' && typeof snapshot.followers_count === 'number')
    .sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))

  if (!normalized.length) return null

  let baseline: ProfileMetricsSnapshotLike | null = null
  let latestAfter: ProfileMetricsSnapshotLike | null = null

  for (const snapshot of normalized) {
    if (snapshot.snapshot_date <= publishedDate) {
      baseline = snapshot
    }
    if (snapshot.snapshot_date >= publishedDate) {
      latestAfter = snapshot
    }
  }

  if (!baseline || !latestAfter || baseline.followers_count == null || latestAfter.followers_count == null) {
    return null
  }

  return latestAfter.followers_count - baseline.followers_count
}

export function normalizeTrendMetrics(
  metrics: Record<string, unknown> | null | undefined,
): TrendNormalizedMetrics {
  const source = metrics ?? {}

  return {
    views: toNumber(source.views ?? source.total_views),
    impressions: toNumber(source.impressions),
    reach: toNumber(source.reach),
    likes: toNumber(source.likes),
    comments: toNumber(source.comments),
    saved: toNumber(source.saved),
    shares: toNumber(source.shares),
    totalInteractions: toNumber(source.total_interactions),
    avgWatchTimeMs: toNumber(source.avg_watch_time_ms ?? source.avg_watch_time ?? source.watch_time),
    totalViewTimeMs: toNumber(source.total_view_time_ms),
    fetchedAt: typeof source.fetched_at === 'string' ? source.fetched_at : null,
  }
}

export function buildTrendStyleStatRows(
  workspaceId: string,
  items: TrendAnalyticsRowInput[],
): Array<Record<string, number | string | null>> {
  const grouped = new Map<string, {
    style: string
    hookPattern: string
    topicCategory: string
    postsCount: number
    viewsTotal: number
    reachTotal: number
    watchTimeTotal: number
    likesTotal: number
    commentsTotal: number
    savesTotal: number
    sharesTotal: number
    followDeltaTotal: number
    followDeltaCount: number
    promptRequestsTotal: number
    dmQualifiedTotal: number
    giveawayDeliveriesTotal: number
  }>()

  for (const item of items) {
    const pattern = hookPattern(item.hookTitle)
    const key = `${item.style}::${pattern}::${item.topicCategory}`
    const current = grouped.get(key) ?? {
      style: item.style,
      hookPattern: pattern,
      topicCategory: item.topicCategory,
      postsCount: 0,
      viewsTotal: 0,
      reachTotal: 0,
      watchTimeTotal: 0,
      likesTotal: 0,
      commentsTotal: 0,
      savesTotal: 0,
      sharesTotal: 0,
      followDeltaTotal: 0,
      followDeltaCount: 0,
      promptRequestsTotal: 0,
      dmQualifiedTotal: 0,
      giveawayDeliveriesTotal: 0,
    }

    current.postsCount += 1
    current.viewsTotal += item.metrics.views
    current.reachTotal += item.metrics.reach
    current.watchTimeTotal += item.metrics.avgWatchTimeMs
    current.likesTotal += item.metrics.likes
    current.commentsTotal += item.metrics.comments
    current.savesTotal += item.metrics.saved
    current.sharesTotal += item.metrics.shares
    current.promptRequestsTotal += item.giveaway.promptRequests
    current.dmQualifiedTotal += item.giveaway.dmReceived
    current.giveawayDeliveriesTotal += item.giveaway.delivered

    if (typeof item.followDelta === 'number') {
      current.followDeltaTotal += item.followDelta
      current.followDeltaCount += 1
    }

    grouped.set(key, current)
  }

  return Array.from(grouped.values()).map((item) => ({
    workspace_id: workspaceId,
    style: item.style,
    hook_pattern: item.hookPattern,
    topic_category: item.topicCategory,
    posts_count: item.postsCount,
    avg_views: item.postsCount ? item.viewsTotal / item.postsCount : 0,
    avg_reach: item.postsCount ? item.reachTotal / item.postsCount : 0,
    avg_watch_time: item.postsCount ? item.watchTimeTotal / item.postsCount : 0,
    avg_likes: item.postsCount ? item.likesTotal / item.postsCount : 0,
    avg_comments: item.postsCount ? item.commentsTotal / item.postsCount : 0,
    avg_saves: item.postsCount ? item.savesTotal / item.postsCount : 0,
    avg_shares: item.postsCount ? item.sharesTotal / item.postsCount : 0,
    avg_follow_delta: item.followDeltaCount ? item.followDeltaTotal / item.followDeltaCount : null,
    avg_prompt_requests: item.postsCount ? item.promptRequestsTotal / item.postsCount : 0,
    avg_dm_qualified: item.postsCount ? item.dmQualifiedTotal / item.postsCount : 0,
    avg_giveaway_deliveries: item.postsCount ? item.giveawayDeliveriesTotal / item.postsCount : 0,
    prompt_request_rate: item.commentsTotal > 0 ? (item.promptRequestsTotal / item.commentsTotal) * 100 : 0,
    dm_conversion_rate: item.promptRequestsTotal > 0 ? (item.dmQualifiedTotal / item.promptRequestsTotal) * 100 : 0,
    delivery_rate: item.promptRequestsTotal > 0 ? (item.giveawayDeliveriesTotal / item.promptRequestsTotal) * 100 : 0,
    updated_at: new Date().toISOString(),
  }))
}
