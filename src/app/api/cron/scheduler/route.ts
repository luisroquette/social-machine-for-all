export const maxDuration = 300

import * as Sentry from '@sentry/nextjs'
import { waitUntil } from '@vercel/functions'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { getTrendVideoOpsObservabilityConfig, TREND_VIDEO_ANIMATE_STATUSES, TREND_VIDEO_METRICS_WINDOW_DAYS } from '@/lib/trends/trend-video-ops-config'
import { getTrendVideoCurrentBottleneck } from '@/lib/trends/trend-video-ops-summary'
import { getNumericVariable } from '@/lib/settings/load-settings'
import { unstickPublishingItems } from '@/lib/agents/publisher/index'

async function runInternalCron(baseUrl: string, path: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
      ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
        ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
        : {}),
    },
    // Called sequentially, awaited, for the trend pipeline crons — a hung one previously
    // blocked all remaining crons and could eat into scheduler's own maxDuration=300.
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}`)
  }
}

async function hasReadyTrendVideoJob(supabase: ReturnType<typeof getAdminClient>): Promise<boolean> {
  const { count, error: e1 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ready')
  if (e1) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler trend_video_jobs.ready(has): ${e1.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return (count ?? 0) > 0
}

async function countReadyTrendVideoJobs(supabase: ReturnType<typeof getAdminClient>): Promise<number> {
  const { count, error: e2 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'ready')
  if (e2) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler trend_video_jobs.ready(count): ${e2.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return count ?? 0
}

async function hasTrendVideoJobToAnimate(supabase: ReturnType<typeof getAdminClient>): Promise<boolean> {
  const { count, error: e3 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .in('status', [...TREND_VIDEO_ANIMATE_STATUSES])
  if (e3) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler trend_video_jobs.animate(has): ${e3.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return (count ?? 0) > 0
}

async function countTrendVideoJobsToAnimate(supabase: ReturnType<typeof getAdminClient>): Promise<number> {
  const { count, error: e4 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .in('status', [...TREND_VIDEO_ANIMATE_STATUSES])
  if (e4) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler trend_video_jobs.animate(count): ${e4.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return count ?? 0
}

async function hasPublishedTrendVideoJobToSync(supabase: ReturnType<typeof getAdminClient>): Promise<boolean> {
  const sinceIso = new Date(Date.now() - TREND_VIDEO_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count, error: e5 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .gte('updated_at', sinceIso)
    .not('published_generated_content_id', 'is', null)
  if (e5) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler trend_video_jobs.sync(has): ${e5.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return (count ?? 0) > 0
}

async function countPublishedTrendVideoJobsToSync(supabase: ReturnType<typeof getAdminClient>): Promise<number> {
  const sinceIso = new Date(Date.now() - TREND_VIDEO_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count, error: e6 } = await supabase
    .from('trend_video_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'published')
    .gte('updated_at', sinceIso)
    .not('published_generated_content_id', 'is', null)
  if (e6) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler trend_video_jobs.sync(count): ${e6.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return count ?? 0
}

async function countPendingInstagramCommentInteractions(supabase: ReturnType<typeof getAdminClient>): Promise<number> {
  const { count, error: e7 } = await supabase
    .from('instagram_comment_interactions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (e7) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler instagram_comment_interactions.pending: ${e7.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return count ?? 0
}

async function countPendingInstagramDmInteractions(supabase: ReturnType<typeof getAdminClient>): Promise<number> {
  const { count, error: e8 } = await supabase
    .from('instagram_dm_interactions')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (e8) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`scheduler instagram_dm_interactions.pending: ${e8.message}`), { tags: { cron: 'scheduler', step: 'db_query_guard' } })
  }

  return count ?? 0
}

/**
 * Master scheduler — runs every 5 minutes via Vercel cron.
 * Reads agents table, checks which agents are "due" based on their
 * schedule_cron and last_run_at, then calls /api/agents/[slug]/run.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()

  // Load all active agents with schedules
  interface ScheduledAgent {
    id: string
    workspace_id: string
    slug: string
    schedule_cron: string | null
    last_run_at: string | null
    schedule_enabled: boolean
  }
  const { data: agents, error } = await supabase
    .from('agents')
    .select('id, workspace_id, slug, schedule_cron, last_run_at, schedule_enabled')
    .eq('active', true)
    .eq('schedule_enabled', true)
    .not('schedule_cron', 'is', null) as { data: ScheduledAgent[] | null; error: unknown }

  if (error || !agents) {
    return NextResponse.json({ error: 'Failed to load agents', details: error }, { status: 500 })
  }

  const now = new Date()
  const triggered: string[] = []
  const errors: string[] = []

  // Unstick items orphaned in 'publishing' (Vercel maxDuration kills the publisher mid-flight).
  // Runs every 5 min for every workspace regardless of the publisher agent's own schedule_cron
  // (e.g. Brand runs only 3x/day — a stuck item could otherwise sit orphaned for ~16h).
  const workspaceIds = [...new Set(agents.map(a => a.workspace_id))]
  await Promise.all(workspaceIds.map(async (workspaceId) => {
    try {
      const retryAttempts = await getNumericVariable(workspaceId, 'publisher_retry_attempts')
      const result = await unstickPublishingItems(supabase, workspaceId, retryAttempts || 3)
      if (result.unstuck) {
        console.log(`[scheduler] Unstuck ${result.unstuck} orphaned items for workspace ${workspaceId} (${result.retried} retried, ${result.failed} failed)`)
      }
    } catch (err) {
      errors.push(`unstick failed for workspace ${workspaceId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }))

  const baseUrl = getBaseUrl()
  const [animateEligible, publishEligible, metricsEligible, giveawayCommentEligible, giveawayDmEligible] = await Promise.all([
    countTrendVideoJobsToAnimate(supabase),
    countReadyTrendVideoJobs(supabase),
    countPublishedTrendVideoJobsToSync(supabase),
    countPendingInstagramCommentInteractions(supabase),
    countPendingInstagramDmInteractions(supabase),
  ])
  const trendVideoBottleneck = getTrendVideoCurrentBottleneck({
    animateEligible,
    publishEligible,
    metricsEligible,
    failed: 0,
  })

  const trendPipelineCrons = [
    '/api/cron/trend-discovery-br',
    '/api/cron/trend-topics-rerank',
    '/api/cron/trend-creative-prepare',
  ]

  for (const path of trendPipelineCrons) {
    try {
      await runInternalCron(baseUrl, path)
      triggered.push(path)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (animateEligible > 0 && await hasTrendVideoJobToAnimate(supabase)) {
    try {
      await runInternalCron(baseUrl, '/api/cron/trend-video-animate')
      triggered.push('/api/cron/trend-video-animate')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (publishEligible > 0 && await hasReadyTrendVideoJob(supabase)) {
    try {
      await runInternalCron(baseUrl, '/api/cron/trend-video-publish')
      triggered.push('/api/cron/trend-video-publish')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (metricsEligible > 0 && await hasPublishedTrendVideoJobToSync(supabase)) {
    try {
      await runInternalCron(baseUrl, '/api/cron/trend-video-metrics')
      triggered.push('/api/cron/trend-video-metrics')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (giveawayCommentEligible > 0) {
    try {
      await runInternalCron(baseUrl, '/api/cron/instagram-comments')
      triggered.push('/api/cron/instagram-comments')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  if (giveawayDmEligible > 0) {
    try {
      await runInternalCron(baseUrl, '/api/cron/instagram-giveaway-delivery')
      triggered.push('/api/cron/instagram-giveaway-delivery')
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  for (const agent of agents) {
    if (!isDue(agent.schedule_cron!, agent.last_run_at, now)) continue

    // Atomically claim this dispatch window — prevents concurrent scheduler
    // invocations (Vercel can run the cron twice simultaneously) from both
    // dispatching the same agent. Only the first UPDATE wins; the second sees
    // no matching row (last_run_at already updated) and skips.
    const claimCutoff = new Date(now.getTime() - 4 * 60 * 1000).toISOString()
    const { data: claimed } = await supabase
      .from('agents')
      .update({ last_run_at: now.toISOString() })
      .eq('id', agent.id)
      .or(`last_run_at.is.null,last_run_at.lt.${claimCutoff}`)
      .select('id')

    if (!claimed?.length) {
      console.log(`[scheduler] ${agent.slug} already claimed by another instance, skipping`)
      continue
    }

    // Use waitUntil so Vercel keeps the function alive until the fetch completes.
    // Plain fire-and-forget (no await) is unreliable in serverless — the container
    // freezes the moment the response is sent, dropping in-flight fetches.
    waitUntil(
      fetch(`${baseUrl}/api/agents/${agent.slug}/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
          ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
            ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
            : {}),
        },
        body: JSON.stringify({
          workspaceId: agent.workspace_id,
          trigger: 'cron',
        }),
        // waitUntil keeps this alive until the fetch settles — bounded near (not at) the
        // dispatched agent's own maxDuration=300 as defense in depth, in case the agent
        // itself somehow fails to respect its own budget.
        signal: AbortSignal.timeout(290_000),
      }).catch((err) => {
        console.error(`[scheduler] dispatch error for ${agent.slug}:`, err instanceof Error ? err.message : err)
      })
    )

    triggered.push(agent.slug)
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    agentsChecked: agents.length,
    trendVideoConfig: getTrendVideoOpsObservabilityConfig(),
    trendVideoEligibility: {
      animateEligible,
      publishEligible,
      metricsEligible,
    },
    giveawayEligibility: {
      commentEligible: giveawayCommentEligible,
      dmEligible: giveawayDmEligible,
    },
    trendVideoBottleneck,
    triggered,
    errors,
  })
}

// Cron parser — determines if an agent is "due" to run.
// Uses cron-parser library for full cron syntax support (Q9):
// ranges (9-17), steps (*/2), lists (1,3,5), day-of-week, etc.
function isDue(cronPattern: string, lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return true

  const lastRun = new Date(lastRunAt)

  // Prevent running twice in the same window (must be at least 4 min since last run)
  const elapsedMinutes = (now.getTime() - lastRun.getTime()) / (1000 * 60)
  if (elapsedMinutes < 4) return false

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CronExpressionParser } = require('cron-parser')
    const interval = CronExpressionParser.parse(cronPattern, {
      currentDate: now,
      tz: 'America/Sao_Paulo',
    })

    // Get the previous scheduled time — if it's after lastRun, agent is due
    const prev = interval.prev().toDate()
    return prev > lastRun
  } catch (err) {
    console.error(`[scheduler] Invalid cron pattern "${cronPattern}":`, err instanceof Error ? err.message : err)
    return false
  }
}
