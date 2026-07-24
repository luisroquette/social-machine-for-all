import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { WORKSPACE_ID } from '@/lib/config/workspace'
import { loadSettings } from '@/lib/settings/load-settings'

/**
 * Daily analytics report — runs at 09:00 BRT (12:00 UTC).
 * Sends a 24h summary to the Telegram group via the editor-in-chief bot.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()
  const settings = await loadSettings(WORKSPACE_ID)
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Publications last 24h by platform
  const { data: published } = await supabase
    .from('generated_content')
    .select('target_platform')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'published')
    .gte('published_at', since24h)

  const pubByPlatform: Record<string, number> = {}
  for (const row of published ?? []) {
    pubByPlatform[row.target_platform] = (pubByPlatform[row.target_platform] ?? 0) + 1
  }

  // Pipeline status counts
  const statusList = ['approved', 'published', 'rejected', 'failed'] as const
  const statusCounts: Record<string, number> = {}
  for (const status of statusList) {
    const { count, error: qErrStatus } = await supabase
      .from('generated_content')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID)
      .eq('status', status)
  if (qErrStatus) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`daily-report generated_content.count_by_status: ${qErrStatus.message}`), { tags: { cron: 'daily-report', step: 'db_query_guard' } })
  }
    statusCounts[status] = count ?? 0
  }

  // Token + cost last 24h (agent_actions uses agent_id UUID, not agent_slug)
  const { data: actions } = await supabase
    .from('agent_actions')
    .select('tokens_used, cost_estimate, status')
    .gte('created_at', since24h)

  const totalTokens = (actions ?? []).reduce((s, a) => s + (a.tokens_used ?? 0), 0)
  const totalCost = (actions ?? []).reduce((s, a) => s + (a.cost_estimate ?? 0), 0)
  const totalActions = (actions ?? []).length
  const totalErrors = (actions ?? []).filter(a => a.status === 'error').length

  // Reels published today (Instagram)
  const { count: reelsToday, error: qErrPub } = await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_format', 'reel')
    .eq('status', 'published')
    .gte('published_at', since24h)
  if (qErrPub) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`daily-report generated_content.published_24h: ${qErrPub.message}`), { tags: { cron: 'daily-report', step: 'db_query_guard' } })
  }

  // Topics discovered today
  const { count: topicsToday, error: qErrTrend } = await supabase
    .from('trending_topics')
    .select('*', { count: 'exact', head: true })
    .gte('detected_at', since24h)
  if (qErrTrend) {
    // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
    Sentry.captureException(new Error(`daily-report trending_topics.detected_24h: ${qErrTrend.message}`), { tags: { cron: 'daily-report', step: 'db_query_guard' } })
  }

  // Agent scores
  const { data: agents, error: agErr } = await supabase
    .from('agents')
    .select('name, avg_score, total_runs')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('active', true)
    .not('avg_score', 'is', null)
    .order('avg_score', { ascending: false })
    .limit(5)

  const platformIcons: Record<string, string> = { x: '🐦', instagram: '📸', linkedin: '💼' }

  const pubLines = Object.keys(pubByPlatform).length
    ? Object.entries(pubByPlatform).map(([p, n]) => `  ${platformIcons[p] ?? '📤'} ${p}: ${n}`).join('\n')
    : '  Nenhuma publicação registrada'

  const today = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(new Date())

  const report = [
    `📊 *Social Machine — Report Diário ${today}*`,
    '',
    '📤 *Publicações (últimas 24h)*',
    pubLines,
    '',
    '🗂 *Pipeline (acumulado)*',
    `  🟡 Aguardando publicação: ${statusCounts.approved}`,
    `  ✅ Publicados: ${statusCounts.published}`,
    `  ❌ Rejeitados: ${statusCounts.rejected}`,
    `  🔴 Falhos (permanente): ${statusCounts.failed}`,
    '',
    '🤖 *AI (últimas 24h)*',
    `  Ações: ${totalActions} (${totalErrors} erros)`,
    `  Tokens: ${(totalTokens / 1000).toFixed(1)}k`,
    `  Custo: $${totalCost.toFixed(3)} USD`,
    '',
    `🎬 *Reels Instagram (24h):* ${reelsToday ?? 0}/${settings.min_reels_per_day} ${(reelsToday ?? 0) >= settings.min_reels_per_day ? '✅' : '❌ abaixo do mínimo'}`,
    `📈 *Topics detectados hoje:* ${topicsToday ?? 0}`,
    '',
    '🏅 *Scores dos agentes*',
    ...(agents ?? []).map(a => `  ${a.name}: ${Number(a.avg_score).toFixed(1)}/10 (${a.total_runs} runs)`),
  ].filter(Boolean).join('\n')

  // Send via editor-in-chief bot
  try {
    const { data: workspace, error: wsErr } = await supabase
      .from('workspaces')
      .select('telegram_group_id')
      .eq('id', WORKSPACE_ID)
      .single()
    if (wsErr) {
      Sentry.captureException(new Error(`daily-report workspaces.telegram: ${wsErr.message}`), { tags: { cron: 'daily-report', step: 'db_query_guard' } })
    }

    const { data: editorAgent } = await supabase
      .from('agents')
      .select('telegram_bot_token')
      .eq('slug', 'editor-in-chief')
      .eq('workspace_id', WORKSPACE_ID)
      .single()
    if (agErr) {
      Sentry.captureException(new Error(`daily-report agents.telegram_bot_token: ${agErr.message}`), { tags: { cron: 'daily-report', step: 'db_query_guard' } })
    }

    const chatId = workspace?.telegram_group_id
    const botToken = editorAgent?.telegram_bot_token

    if (chatId && botToken) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(10_000),
        body: JSON.stringify({ chat_id: chatId, text: report, parse_mode: 'Markdown' }),
      })
    } else {
      console.warn('[daily-report] Missing chatId or botToken, report not sent')
    }
  } catch (err) {
    console.error('[daily-report] Failed to send:', err instanceof Error ? err.message : err)
  }

  return NextResponse.json({ ok: true, report })
}
