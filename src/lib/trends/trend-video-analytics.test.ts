import { describe, expect, it } from 'vitest'
import {
  buildTrendStyleStatRows,
  computeFollowDelta,
  hookPattern,
  normalizeTrendMetrics,
  summarizeGiveawayFunnel,
} from './trend-video-analytics'

describe('trend-video-analytics', () => {
  it('normalizes metrics from mixed raw payloads', () => {
    expect(normalizeTrendMetrics({
      total_views: '1500',
      reach: 900,
      likes: '80',
      comments: 25,
      saved: 12,
      shares: 9,
      total_interactions: 126,
      avg_watch_time_ms: 4300,
      fetched_at: '2026-07-07T10:00:00.000Z',
    })).toEqual({
      views: 1500,
      impressions: 0,
      reach: 900,
      likes: 80,
      comments: 25,
      saved: 12,
      shares: 9,
      totalInteractions: 126,
      avgWatchTimeMs: 4300,
      totalViewTimeMs: 0,
      fetchedAt: '2026-07-07T10:00:00.000Z',
    })
  })

  it('summarizes giveaway funnel and request rate', () => {
    const summary = summarizeGiveawayFunnel([
      { status: 'comment_replied', replied_at: '2026-07-07T10:00:00.000Z' },
      { status: 'delivered', replied_at: '2026-07-07T10:01:00.000Z', dm_received_at: '2026-07-07T10:02:00.000Z', qualified_at: '2026-07-07T10:02:00.000Z', delivered_at: '2026-07-07T10:03:00.000Z' },
      { status: 'failed', replied_at: '2026-07-07T10:04:00.000Z', dm_received_at: '2026-07-07T10:05:00.000Z' },
    ], 12)

    expect(summary).toEqual({
      promptRequests: 3,
      commentReplies: 3,
      dmReceived: 2,
      qualified: 1,
      delivered: 1,
      failed: 1,
      promptRequestRate: 25,
      dmConversionRate: 66.67,
      deliveryRate: 33.33,
    })
  })

  it('computes follower delta from snapshots around the publish date', () => {
    expect(computeFollowDelta([
      { snapshot_date: '2026-07-01', followers_count: 1000 },
      { snapshot_date: '2026-07-03', followers_count: 1012 },
      { snapshot_date: '2026-07-07', followers_count: 1040 },
    ], '2026-07-03T12:00:00.000Z')).toBe(28)
  })

  it('builds grouped style stats with giveaway rates', () => {
    const rows = buildTrendStyleStatRows('ws-1', [
      {
        style: 'ultrareal',
        hookTitle: 'Isso explodiu hoje',
        topicCategory: 'sports',
        metrics: normalizeTrendMetrics({ views: 1000, reach: 800, likes: 50, comments: 20, saved: 10, shares: 6 }),
        giveaway: summarizeGiveawayFunnel([{ status: 'delivered', dm_received_at: 'x', delivered_at: 'y' }], 20),
        followDelta: 12,
      },
      {
        style: 'ultrareal',
        hookTitle: 'Isso explodiu hoje mesmo',
        topicCategory: 'sports',
        metrics: normalizeTrendMetrics({ views: 2000, reach: 1200, likes: 90, comments: 30, saved: 14, shares: 10 }),
        giveaway: summarizeGiveawayFunnel([{ status: 'comment_replied' }, { status: 'failed', dm_received_at: 'x' }], 30),
        followDelta: 8,
      },
    ])

    expect(rows).toHaveLength(1)
    expect(hookPattern('Isso explodiu hoje mesmo')).toBe('isso explodiu hoje')
    expect(rows[0]).toMatchObject({
      workspace_id: 'ws-1',
      style: 'ultrareal',
      hook_pattern: 'isso explodiu hoje',
      topic_category: 'sports',
      posts_count: 2,
      avg_views: 1500,
      avg_reach: 1000,
      avg_likes: 70,
      avg_comments: 25,
      avg_saves: 12,
      avg_shares: 8,
      avg_follow_delta: 10,
      avg_prompt_requests: 1.5,
      avg_dm_qualified: 1,
      avg_giveaway_deliveries: 0.5,
      prompt_request_rate: 6,
      dm_conversion_rate: 66.66666666666666,
      delivery_rate: 33.33333333333333,
    })
  })
})
