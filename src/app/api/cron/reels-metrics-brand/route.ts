import { INSTAGRAM_API_BASE } from '@/lib/config/constants'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { fetchFollowerCount } from '@/lib/platforms/instagram/follower-count'
import { IG_INSIGHTS_METRICS, buildEngagementUpdate, parsePermanentAuthError } from '@/lib/eval/engagement-metrics'
import type { TablesUpdate } from '@/lib/supabase/database.types'

const WORKSPACE_ID = process.env.WORKSPACE_ID?.trim() ?? ''

export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!WORKSPACE_ID) {
    return NextResponse.json({ error: 'WORKSPACE_ID is not configured' }, { status: 503 })
  }

  const backfill = new URL(request.url).searchParams.get('backfill') === '1'

  const { accessToken: igToken, igUserId } = await getInstagramCredentials(WORKSPACE_ID)
  if (!igToken) return NextResponse.json({ error: 'No IG token for workspace' }, { status: 500 })

  const supabase = getAdminClient()

  let alertCreds: { chatId?: string; botToken?: string } | null = null
  async function notifyTelegram(text: string) {
    try {
      if (!alertCreds) {
        const { data: workspace } = await supabase.from('workspaces').select('telegram_group_id').eq('id', WORKSPACE_ID).single()
        const { data: editorAgent } = await supabase.from('agents').select('telegram_bot_token').eq('slug', 'editor-in-chief').eq('workspace_id', WORKSPACE_ID).limit(1).single()
        alertCreds = {
          chatId: (workspace as { telegram_group_id?: number | string } | null)?.telegram_group_id?.toString(),
          botToken: (editorAgent as { telegram_bot_token?: string } | null)?.telegram_bot_token,
        }
      }
      const { chatId, botToken } = alertCreds
      if (!chatId || !botToken) return
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
        signal: AbortSignal.timeout(10_000),
      }).catch(() => {})
    } catch { /* alerts são best-effort */ }
  }

  let followersCount: number | null = null
  try {
    const snap = await fetchFollowerCount(INSTAGRAM_API_BASE, igUserId, igToken)
    if (snap) {
      followersCount = snap.followersCount
      const today = new Date().toISOString().slice(0, 10)
      await supabase.from('profile_metrics_snapshots').upsert(
        { workspace_id: WORKSPACE_ID, snapshot_date: today, followers_count: snap.followersCount, media_count: snap.mediaCount },
        { onConflict: 'workspace_id,snapshot_date' },
      )
    }
  } catch { /* snapshot é best-effort */ }

  let query = supabase
    .from('generated_content')
    .select('id, published_id, published_at')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_platform', 'instagram')
    .eq('target_format', 'reel')
    .eq('status', 'published')
    .not('published_id', 'is', null)
    .order('published_at', { ascending: false })

  query = backfill
    ? query.is('engagement_metrics', null).limit(25)
    : query.gte('published_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()).limit(30)

  const { data: reels } = await query

  if (!reels?.length) {
    return NextResponse.json({ ok: true, updated: 0, reason: backfill ? 'backfill_done' : 'no_reels', backfill, followersCount })
  }

  let updated = 0
  let failed = 0
  let authError: { code: number; message: string } | null = null
  const results: Array<{ id: string; reach: number; likes: number; saves: number; avgWatch: number }> = []

  for (const reel of reels) {
    try {
      const res = await fetch(
        `${INSTAGRAM_API_BASE}/${reel.published_id}/insights?metric=${IG_INSIGHTS_METRICS}&access_token=${igToken}`,
        { signal: AbortSignal.timeout(10_000) },
      )

      if (!res.ok) {
        const errBody = await res.text()
        console.error(`[reels-metrics-brand] IG insights ${res.status} for ${reel.published_id}: ${errBody.slice(0, 200)}`)
        failed++
        const permErr = parsePermanentAuthError(errBody)
        if (permErr) authError = permErr
        continue
      }

      const data = await res.json() as { data: Array<{ name: string; values: Array<{ value: number }> }> }
      const metrics: Record<string, number> = {}
      for (const m of data.data || []) {
        metrics[m.name] = m.values?.[0]?.value ?? 0
      }

      const engagement = {
        reach: metrics.reach || 0,
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        saved: metrics.saved || 0,
        shares: metrics.shares || 0,
        total_interactions: metrics.total_interactions || 0,
        avg_watch_time_ms: metrics.ig_reels_avg_watch_time || 0,
        total_view_time_ms: metrics.ig_reels_video_view_total_time || 0,
        fetched_at: new Date().toISOString(),
      }

      await supabase
        .from('generated_content')
        .update(buildEngagementUpdate(engagement) as unknown as TablesUpdate<'generated_content'>)
        .eq('id', reel.id)

      updated++
      results.push({
        id: reel.published_id as string,
        reach: engagement.reach,
        likes: engagement.likes,
        saves: engagement.saved,
        avgWatch: Math.round(engagement.avg_watch_time_ms / 1000),
      })
    } catch {
      failed++
    }
  }

  if (authError && updated === 0) {
    Sentry.captureMessage(
      `reels-metrics-brand: IG insights bloqueado (code ${authError.code}) — ${authError.message.slice(0, 140)}`,
      { level: 'error', tags: { cron: 'reels-metrics-brand', step: 'insights_auth' } },
    )
    await notifyTelegram(
      `⚠️ *Métricas de Reels paradas (@brand)*\n` +
      `A API de insights do Instagram retornou erro de credencial (código ${authError.code}). ` +
      `\`reach\` e engajamento NÃO serão coletados até regenerar o token com escopo \`instagram_manage_insights\`.\n\n` +
      `_${authError.message.slice(0, 160)}_`
    )
  }

  try {
    const { data: recentReels } = await supabase
      .from('generated_content')
      .select('engagement_rate')
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', 'published')
      .not('engagement_rate', 'is', null)
      .order('published_at', { ascending: false })
      .limit(7)
    if (recentReels && recentReels.length >= 3) {
      const avgEng = recentReels.reduce((s, r) => s + ((r as { engagement_rate: number }).engagement_rate ?? 0), 0) / recentReels.length
      if (avgEng < 0.5) {
        await notifyTelegram(`⚠️ *Engagement Alert (@brand)*\nMédia dos últimos ${recentReels.length} reels: *${avgEng.toFixed(2)}%* (abaixo de 0.5%)`)
      }
    }
  } catch { /* C2 é non-critical */ }

  return NextResponse.json({ ok: true, updated, failed, backfill, followersCount, results })
}
