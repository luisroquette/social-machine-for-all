export const maxDuration = 120

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getNumericVariable } from '@/lib/settings/load-settings'
import { materializeStaticNewsCandidate, type StaticNewsCandidate } from '@/lib/pipeline/brand-static-news'
import { refineStaticNewsCandidateMedia } from '@/lib/pipeline/brand-static-visual'
import type { TablesInsert } from '@/lib/supabase/database.types'

const WORKSPACE_ID = process.env.WORKSPACE_ID?.trim() ?? ''

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!WORKSPACE_ID) {
    return NextResponse.json({ error: 'WORKSPACE_ID is not configured' }, { status: 503 })
  }

  const [minRelevanceScore, lookbackHours, candidateLimit] = await Promise.all([
    getNumericVariable(WORKSPACE_ID, 'reel_min_relevance_score'),
    getNumericVariable(WORKSPACE_ID, 'reel_lookback_hours'),
    getNumericVariable(WORKSPACE_ID, 'reel_candidate_limit'),
  ])

  const supabase = getAdminClient()
  const lookbackCutoff = new Date(Date.now() - (lookbackHours || 72) * 60 * 60 * 1000).toISOString()

  const { data: candidates, error } = await supabase
    .from('curated_content')
    .select('id, workspace_id, source_platform, source_url, source_author, source_content, source_metrics, relevance_score')
    .eq('workspace_id', WORKSPACE_ID)
    .in('status', ['curated', 'written'])
    .not('source_url', 'is', null)
    .gte('created_at', lookbackCutoff)
    .gte('relevance_score', minRelevanceScore || 20)
    .order('relevance_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(candidateLimit || 20)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const materializedBase = (candidates ?? [])
    .map((item) => materializeStaticNewsCandidate(item as never))
    .filter((item): item is StaticNewsCandidate => item !== null)

  const materialized = await Promise.all(
    materializedBase.map((item) => refineStaticNewsCandidateMedia(item))
  )

  if (!materialized.length) {
    return NextResponse.json({ ok: true, queued: 0, skipped: 'no_static_news_candidates' })
  }

  const queued: string[] = []
  const skippedReasons: Record<string, number> = {}

  for (const item of materialized) {
    const { data: existing } = await supabase
      .from('instagram_static_news_queue')
      .select('id')
      .eq('curated_content_id', item.curated_content_id)
      .maybeSingle()

    if (existing?.id) {
      skippedReasons.duplicate = (skippedReasons.duplicate ?? 0) + 1
      continue
    }

    const { error: insertError } = await supabase.from('instagram_static_news_queue').insert(item as TablesInsert<'instagram_static_news_queue'>)
    if (insertError) {
      skippedReasons.insert_error = (skippedReasons.insert_error ?? 0) + 1
      continue
    }
    queued.push(item.curated_content_id)
  }

  return NextResponse.json({
    ok: true,
    queued: queued.length,
    queuedIds: queued,
    skippedReasons,
  })
}
