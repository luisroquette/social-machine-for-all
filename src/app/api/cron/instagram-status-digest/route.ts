import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { WORKSPACE_ID } from '@/lib/config/constants'
import { getVariable } from '@/lib/settings/load-settings'
import { sendReportEmail } from '@/lib/export/report-email'
import { hoursSince, isInstagramStale } from '@/lib/monitoring/instagram-freshness'

const ALERT_EMAIL = process.env.NOTIFICATION_EMAIL?.trim() ?? ''
const STALE_HOURS = 24

const WORKSPACES = [WORKSPACE_ID, process.env.SECONDARY_WORKSPACE_ID?.trim()].filter((id): id is string => Boolean(id))

/**
 * Digest de status do Instagram — roda em horários fixos, 2x/dia (ver vercel.json).
 *
 * Garantia INDEPENDENTE de qualquer cooldown/dedup/pause-week do heartbeat reativo
 * (src/app/api/cron/heartbeat/route.ts). Pedido explícito do usuário após o outage
 * de jun/2026, em que a supressão da pause week silenciou o alerta real por dias:
 * este digest não suprime nada — só reporta o fato (há quantas horas foi o último
 * post publicado) e alerta sempre que estiver "stale", em toda execução (2x/dia).
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!WORKSPACE_ID) {
    return NextResponse.json({ error: 'WORKSPACE_ID is not configured' }, { status: 503 })
  }

  const supabase = getAdminClient()
  const now = Date.now()
  const results: Array<{ workspaceId: string; handle: string; lastPublishedAt: string | null; hoursSinceLastPublish: number | null; stale: boolean }> = []

  for (const workspaceId of WORKSPACES) {
    const handle = await getVariable(workspaceId, 'instagram_handle')

    const { data, error: qErr } = await supabase
      .from('generated_content')
      .select('published_at')
      .eq('workspace_id', workspaceId)
      .eq('target_format', 'reel')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(1)

    if (qErr) {
      // Guard 42703: erro de query não lança no supabase-js — surfar no Sentry, nunca engolir
      Sentry.captureException(new Error(`instagram-status-digest last_published: ${qErr.message}`), { tags: { cron: 'instagram-status-digest', step: 'db_query_guard' } })
    }
    const lastPublishedAt = data?.[0]?.published_at ?? null
    const hrs = hoursSince(now, lastPublishedAt)
    results.push({
      workspaceId,
      handle: handle || '(handle não configurado)',
      lastPublishedAt,
      hoursSinceLastPublish: hrs,
      stale: isInstagramStale(hrs, STALE_HOURS),
    })
  }

  const staleResults = results.filter(r => r.stale)

  if (staleResults.length > 0 && ALERT_EMAIL) {
    const timestamp = new Date(now).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
    const lines = staleResults.map(r => {
      const detail = r.hoursSinceLastPublish === null
        ? 'nenhum post publicado registrado'
        : `último post há ${r.hoursSinceLastPublish.toFixed(1)}h`
      return `- ${r.handle}: ${detail} (limite: ${STALE_HOURS}h)`
    })
    const content = [
      `## 🔴 Instagram sem postagens`,
      `**Horário:** ${timestamp} BRT`,
      ``,
      ...lines,
      ``,
      `*Este é um alerta de verificação fixa, enviado até 2x ao dia enquanto o problema persistir — não depende do heartbeat reativo.*`,
    ].join('\n')

    try {
      await sendReportEmail({
        to: ALERT_EMAIL,
        subject: `🔴 Instagram sem postagens — ${staleResults.length} conta(s) [${timestamp}]`,
        content,
        label: { system: 'Social Machine V3.1', scope: staleResults.map(r => r.handle).join(' + ') },
      })
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'instagram-status-digest', step: 'email_alert' } })
      console.error('[instagram-status-digest] Email alert failed:', err instanceof Error ? err.message : err)
    }

    for (const workspaceId of staleResults.map(r => r.workspaceId)) {
      try {
        const [{ data: workspace }, { data: editorAgent }] = await Promise.all([
          supabase
            .from('workspaces')
            .select('telegram_group_id')
            .eq('id', workspaceId)
            .single() as unknown as Promise<{ data: { telegram_group_id: number | null } | null }>,
          supabase
            .from('agents')
            .select('telegram_bot_token')
            .eq('slug', 'editor-in-chief')
            .eq('workspace_id', workspaceId)
            .limit(1)
            .single() as unknown as Promise<{ data: { telegram_bot_token: string | null } | null }>,
        ])

        const chatId = workspace?.telegram_group_id
        const botToken = editorAgent?.telegram_bot_token
        if (chatId && botToken) {
          const r = staleResults.find(x => x.workspaceId === workspaceId)!
          const detail = r.hoursSinceLastPublish === null
            ? 'nenhum post publicado registrado'
            : `último post há ${r.hoursSinceLastPublish.toFixed(1)}h`
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              chat_id: chatId,
              text: `🔴 Instagram sem postagens — ${r.handle}\n${detail} (limite: ${STALE_HOURS}h)`,
            }),
          })
        }
      } catch (err) {
        Sentry.captureException(err, { tags: { cron: 'instagram-status-digest', step: 'telegram_alert', workspaceId } })
      }
    }
  }

  return NextResponse.json({ ok: staleResults.length === 0, checkedAt: new Date(now).toISOString(), results })
}
