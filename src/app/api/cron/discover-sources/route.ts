import { WORKSPACE_ID } from '@/lib/config/constants'
export const maxDuration = 60

import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getNumericVariable } from '@/lib/settings/load-settings'


/**
 * Auto-discover new monitor sources from curated content.
 * Runs daily — finds authors who consistently produce good AI content
 * but aren't yet in the radar.
 *
 * Logic:
 * 1. Query curated_content from last 7 days
 * 2. Group by source_author, count items + avg score
 * 3. Filter: ≥2 curated items AND avg score ≥ 40
 * 4. Exclude authors already in monitor_sources
 * 5. Auto-add new sources + notify via Telegram
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [minRelevanceScore, lookbackDays, minEngagement, maxNewSources] = await Promise.all([
    getNumericVariable(WORKSPACE_ID, 'reel_min_relevance_score'),
    getNumericVariable(WORKSPACE_ID, 'discover_sources_lookback_days'),
    getNumericVariable(WORKSPACE_ID, 'discover_sources_min_engagement'),
    getNumericVariable(WORKSPACE_ID, 'discover_sources_max_new'),
  ])

  const supabase = getAdminClient()
  const sinceDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString()

  // 1. Find productive authors from recent curated content
  let authorStats = null
  try {
    // get_author_stats não existe no schema de prod (confirmado 12/07/2026) —
    // o fallback abaixo é o caminho real; cast mantém o probe sem quebrar o build.
    const res = await supabase.rpc('get_author_stats' as never, {
      p_workspace_id: WORKSPACE_ID,
      p_since: sinceDate,
    } as never)
    authorStats = res.data
  } catch {
    // RPC doesn't exist yet — use fallback
  }

  // Fallback: raw SQL if RPC doesn't exist
  let candidates: Array<{ handle: string; count: number; avg_score: number; has_video: boolean }> = []

  if (!authorStats) {
    // Direct query approach
    const { data: rawData } = await supabase
      .from('curated_content')
      .select('source_author, relevance_score, source_metrics')
      .eq('workspace_id', WORKSPACE_ID)
      .gte('created_at', sinceDate)
      .not('source_author', 'is', null)

    if (rawData) {
      // Group by author manually
      const authorMap = new Map<string, { scores: number[]; hasVideo: boolean }>()

      for (const item of rawData) {
        const author = item.source_author as string
        if (!author) continue

        const entry = authorMap.get(author) || { scores: [], hasVideo: false }
        entry.scores.push(item.relevance_score ?? 0)

        const metrics = item.source_metrics as Record<string, unknown> | null
        const mediaTypes = metrics?.media_types as string[] | null
        if (mediaTypes?.includes('video')) entry.hasVideo = true

        authorMap.set(author, entry)
      }

      for (const [handle, data] of authorMap) {
        const avg = data.scores.reduce((a, b) => a + b, 0) / data.scores.length
        if (data.scores.length >= 2 && avg >= minRelevanceScore) {
          candidates.push({
            handle,
            count: data.scores.length,
            avg_score: Math.round(avg),
            has_video: data.hasVideo,
          })
        }
      }

      // Sort: video sources first, then by count × avg_score
      candidates.sort((a, b) => {
        if (a.has_video && !b.has_video) return -1
        if (!a.has_video && b.has_video) return 1
        return (b.count * b.avg_score) - (a.count * a.avg_score)
      })
    }
  }

  // 1b. Filter out off-topic candidates by handle keywords
  // Handles containing these strings are almost certainly crypto/trading accounts
  const BANNED_HANDLE_SUBSTRINGS = ['eth', 'btc', 'crypto', 'nft', 'defi', 'token', 'coin', 'trader', 'trading', 'hodl', 'sol', 'xrp', 'bnb', 'doge', 'forex', 'signal']
  candidates = candidates.filter(c => {
    const handleLower = c.handle.toLowerCase()
    return !BANNED_HANDLE_SUBSTRINGS.some(sub => handleLower.includes(sub))
  })

  // 2. Get existing monitor sources
  const { data: existingSources } = await supabase
    .from('monitor_sources')
    .select('handle')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('platform', 'x')

  const existingHandles = new Set((existingSources ?? []).map(s => (s.handle as string).toLowerCase()))

  // 3. Filter out already monitored
  const newSources = candidates.filter(c => !existingHandles.has(c.handle.toLowerCase()))

  if (newSources.length === 0) {
    return NextResponse.json({ ok: true, discovered: 0, message: 'No new sources found' })
  }

  // 4. Add top 10 new sources (cap to avoid spam)
  const toAdd = newSources.slice(0, maxNewSources)

  for (const source of toAdd) {
    try {
      await supabase.from('monitor_sources').insert({
        workspace_id: WORKSPACE_ID,
        platform: 'x',
        handle: source.handle,
        min_engagement: minEngagement,
        active: true,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('duplicate') && !msg.includes('unique')) {
        Sentry.captureException(err, { tags: { cron: 'discover-sources', step: 'insert_monitor_source' }, extra: { handle: source.handle } })
      }
    }
  }

  // 5. Notify via Telegram
  // Telegram notification intentionally removed — operational noise, not a publication or alert.

  return NextResponse.json({
    ok: true,
    discovered: toAdd.length,
    total_sources: existingHandles.size + toAdd.length,
    added: toAdd.map(s => ({ handle: s.handle, count: s.count, avg_score: s.avg_score, has_video: s.has_video })),
    remaining_candidates: newSources.length - toAdd.length,
  })
}
