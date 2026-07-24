import * as Sentry from '@sentry/nextjs'
import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { WORKSPACE_ID } from '@/lib/config/constants'
import { loadSettings, getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { sendReportEmail } from '@/lib/export/report-email'
import { isOpenAiQuotaExceeded } from '@/lib/ai/check-openai-quota'
import { createDbErrorCollector, guardCount, guardData } from '@/lib/monitoring/heartbeat-query-guard'

const ALERT_EMAIL = 'lfrprojects.ai@gmail.com'
const EMAIL_COOLDOWN_MS = 4 * 60 * 60 * 1000 // 4h entre emails do mesmo alerta

const brandMOB_WS = '00000000-0000-0000-0000-000000000000'

/**
 * Health check — runs every 15 minutes.
 * Only alerts during business hours (8-22 BRT). Silent during quiet hours.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Respect quiet hours — no alerts between 22:00 and 08:00 BRT
  const now = new Date()
  const brtHour = parseInt(new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo',
  }).format(now), 10)

  if (brtHour < 8 || brtHour >= 22) {
    return NextResponse.json({ ok: true, skipped: 'quiet_hours', brtHour })
  }

  const supabase = getAdminClient()
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
  // Lido do settings, não hardcoded — evita que os avisos fiquem com o @ errado
  // depois de uma troca de handle (histórico: @thedoomguy_ai → @inteligencia.artificial.brazil).
  const igHandle = await getVariable(WORKSPACE_ID, 'instagram_handle')

  // NOTE: stale agents are intentionally NOT checked here.
  // Editor-in-chief already reports stale agents with full context (scores, errors).
  // Heartbeat covers infra-level signals only: stuck pipelines, error rate, reels minimum.

  // Toda query de monitoramento passa pelo guard: erro de Postgres (42703 etc.)
  // não lança exceção no supabase-js — sem o guard, o null passa pelos `?? 0` e o
  // watchdog fica cego em silêncio (incidente de 04/07/2026, 16 dias sem alerta).
  const dbGuard = createDbErrorCollector()

  const stuckPipelines = guardData<{ id: string }[]>(dbGuard, 'pipeline_runs.stuck', await supabase
    .from('pipeline_runs')
    .select('id')
    .eq('status', 'running')
    .lt('started_at', threeHoursAgo))

  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  const recentErrors = guardCount(dbGuard, 'agent_actions.recent_errors', await supabase
    .from('agent_actions')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'error')
    .gte('created_at', oneHourAgo))

  // ── Reels pipeline health checks ──
  const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString()

  // Check: consecutive download failures (cookies expired?)
  const recentReelRuns = guardData(dbGuard, 'generated_content.recent_reel_runs', await supabase
    .from('generated_content')
    .select('status, created_at')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_format', 'reel')
    .gte('created_at', new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5))

  // Check: failed reels (render or publish failures)
  const failedReels = guardCount(dbGuard, 'generated_content.failed_reels', await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_format', 'reel')
    .eq('status', 'failed')
    .gte('created_at', sixHoursAgo))

  // Check: reels published without cover or subtitles (quality issue)
  const recentPublished = guardData(dbGuard, 'generated_content.recent_published', await supabase
    .from('generated_content')
    .select('id, content, published_at')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_format', 'reel')
    .eq('status', 'published')
    .gte('published_at', sixHoursAgo)
    .order('published_at', { ascending: false })
    .limit(5))

  let noCoverCount = 0
  let noSubsCount = 0
  for (const r of recentPublished ?? []) {
    try {
      const c = JSON.parse(r.content as string)
      if (!c.backgroundUrl) noCoverCount++
      if (!c.subtitles?.length) noSubsCount++
    } catch { /* skip */ }
  }

  // Check: Twitter API credits — agent_actions.error_message (curator/engagement)
  // Janela 1h (não 6h): evita falso-positivo quando crédito foi recarregado ou 402 foi transiente.
  // Threshold >= 2: um único 402 esporádico não dispara alerta — X API retorna 402 em erros
  // transientes mesmo com saldo positivo (ex: endpoint restriction, spike temporário).
  const twitterCreditErrors = guardCount(dbGuard, 'agent_actions.twitter_credit_errors', await supabase
    .from('agent_actions')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .like('error_message', '%CreditsDepleted%')
    .gte('created_at', oneHourAgo))

  // Check: Anthropic API credits — agent_actions.error_message
  // Detecta "credit balance is too low" que aparece no reviewer_run quando a conta
  // Anthropic está sem crédito. Em jun/2026 esse erro travou o pipeline por 3 dias
  // sem alerta porque o heartbeat só checava Twitter e OpenAI.
  // Janela de 1h (não 6h) para evitar falso-positivo após recarregar créditos.
  const anthropicCreditErrors = guardCount(dbGuard, 'agent_actions.anthropic_credit_errors', await supabase
    .from('agent_actions')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .like('error_message', '%credit balance is too low%')
    .gte('created_at', oneHourAgo))

  // Check: Twitter API credits — generated_content.review_feedback (publisher)
  // Usa ilike + "credits depleted" (lowercase) — que é o que o publisher realmente escreve
  // quando XClient.publish() retorna "Publishing disabled (credits depleted)".
  const publisherCreditErrors = guardCount(dbGuard, 'generated_content.publisher_credit_errors', await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .ilike('review_feedback', '%credits depleted%')
    .gte('created_at', oneHourAgo))

  // Check: curator stuck in 'running' for >1h (Vercel timeout — auto-reset only at next scheduled run)
  // Em jun/2026 o curator ficou travado em 'running' por horas sem alerta enquanto pipeline secava.
  const stuckCuratorRuns = guardCount(dbGuard, 'agent_actions.stuck_curator_runs', await supabase
    .from('agent_actions')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('action_type', 'curator_run')
    .eq('status', 'running')
    .lt('created_at', oneHourAgo))

  // Check: no X content published in the last 12h (during business hours)
  // Only fire between 12:00-22:00 BRT — gives pipeline time to warm up after quiet hours
  const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()
  const xPublishedRecently = brtHour >= 12
    ? guardCount(dbGuard, 'generated_content.x_published_12h', await supabase
        .from('generated_content')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', WORKSPACE_ID)
        .eq('target_platform', 'x')
        .eq('status', 'published')
        .gte('published_at', twelveHoursAgo))
    : 1 // before noon — don't check yet

  // Check: IG token health — use workspace DB credentials, not env vars.
  // O host depende do tipo de token: IGAA → graph.instagram.com; EAA (Page/System
  // User) → graph.facebook.com. Fixar o host fazia o check falhar (falso "expirado")
  // para tokens EAA. Só marcamos expirado em erro de auth (400/401), nunca em falha
  // transitória (429/5xx) — senão um rate-limit vira alerta crítico indevido.
  let igTokenExpired = false
  const { igUserId, accessToken: igToken } = await getInstagramCredentials(WORKSPACE_ID)
  if (igToken && igUserId) {
    const igBase = igToken.startsWith('IGAA')
      ? 'https://graph.instagram.com/v21.0'
      : 'https://graph.facebook.com/v21.0'
    try {
      const igCheck = await fetch(`${igBase}/${igUserId}?fields=id&access_token=${igToken}`, { signal: AbortSignal.timeout(10_000) })
      if (igCheck.status === 400 || igCheck.status === 401) igTokenExpired = true
    } catch { /* falha de rede transitória — não marca como expirado */ }
  }

  // Mesmo check acima, espelhado pro Brand — achado 2026-07-11: este heartbeat
  // já monitora reel_ready/failed/published do @brand, mas o token de Instagram
  // dele (conta própria, brandMOB_WS) nunca era checado. Se expirasse, ninguém seria avisado.
  let igTokenExpiredbrand = false
  const { igUserId: igUserIdbrand, accessToken: igTokenbrand } = await getInstagramCredentials(brandMOB_WS)
  if (igTokenbrand && igUserIdbrand) {
    const igBasebrand = igTokenbrand.startsWith('IGAA')
      ? 'https://graph.instagram.com/v21.0'
      : 'https://graph.facebook.com/v21.0'
    try {
      const igCheckbrand = await fetch(`${igBasebrand}/${igUserIdbrand}?fields=id&access_token=${igTokenbrand}`, { signal: AbortSignal.timeout(10_000) })
      if (igCheckbrand.status === 400 || igCheckbrand.status === 401) igTokenExpiredbrand = true
    } catch { /* falha de rede transitória — não marca como expirado */ }
  }

  // Check: OpenAI quota/billing — probe ativo barato (gpt-4o-mini, 1 token).
  // A quota da OpenAI estourou em jun/2026 e travou as capas de reel por dias sem
  // alerta. Este check fecha a lacuna. Só marca true em insufficient_quota/billing.
  const openaiQuotaExceeded = await isOpenAiQuotaExceeded(process.env.OPENAI_API_KEY ?? '')

  // Check: no reels produced in 24h (pipeline may be stuck)
  const noReelsProduced = !recentReelRuns?.length

  // A3 (pause week) foi removido em 04/07/2026 — a supressão de alertas por
  // "pausa intencional" saiu junto. Fila vazia agora alerta SEMPRE, sem
  // exceção de calendário (a supressão mascarou o outage do DoomGuyFrame).

  // ── New checks: reel_ready queue depth + stuck publishing ──
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString()

  const reelReadyAiTech = guardCount(dbGuard, 'generated_content.reel_ready_aitech', await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', WORKSPACE_ID)
    .eq('target_format', 'reel')
    .eq('status', 'reel_ready'))

  const reelReadybrand = guardCount(dbGuard, 'generated_content.reel_ready_brand', await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', brandMOB_WS)
    .eq('target_format', 'reel')
    .eq('status', 'reel_ready'))

  // Items stuck in 'publishing' for > 30 min indicate a hung publish run.
  // Esta é A query do incidente 42703 (updated_at inexistente por 16 dias).
  const stuckPublishing = guardData<{ id: string; workspace_id: string }[]>(dbGuard, 'generated_content.stuck_publishing', await supabase
    .from('generated_content')
    .select('id, workspace_id')
    .eq('target_format', 'reel')
    .eq('status', 'publishing')
    .lt('updated_at', thirtyMinAgo))

  const failedReelsbrand = guardCount(dbGuard, 'generated_content.failed_reels_brand', await supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', brandMOB_WS)
    .eq('target_format', 'reel')
    .eq('status', 'failed')
    .gte('created_at', sixHoursAgo))

  // Start of today in BRT (midnight BRT = UTC-3 = 03:00 UTC) — usado tanto pro
  // guard de "meta já batida" abaixo quanto pelo check de mínimo diário (21h BRT).
  const todayBRT = new Date(now)
  todayBRT.setUTCHours(3, 0, 0, 0)
  if (now.getUTCHours() < 3) todayBRT.setUTCDate(todayBRT.getUTCDate() - 1)
  const todayISO = todayBRT.toISOString()

  // Meta do dia já batida? Evidência real (published hoje >= target), não suposição
  // de calendário — achado 2026-07-10: "fila reel_ready vazia" alarmava mesmo com a
  // meta do dia (2/2) já cumprida. target=0/ausente nunca satisfaz o guard, então
  // workspaces sem essa config (ex: AI & Tech hoje) mantêm o comportamento de sempre.
  const [resPublishedTodayAiTech, resPublishedTodaybrand, targetReelsAiTech, targetReelsbrand] = await Promise.all([
    supabase.from('generated_content').select('*', { count: 'exact', head: true })
      .eq('workspace_id', WORKSPACE_ID).eq('target_format', 'reel').eq('status', 'published')
      .gte('published_at', todayISO) as unknown as Promise<{ count: number | null; error: { message: string; code?: string } | null }>,
    supabase.from('generated_content').select('*', { count: 'exact', head: true })
      .eq('workspace_id', brandMOB_WS).eq('target_format', 'reel').eq('status', 'published')
      .gte('published_at', todayISO) as unknown as Promise<{ count: number | null; error: { message: string; code?: string } | null }>,
    getNumericVariable(WORKSPACE_ID, 'target_reels_per_day'),
    getNumericVariable(brandMOB_WS, 'target_reels_per_day'),
  ])
  const reelsPublishedTodayAiTech = guardCount(dbGuard, 'generated_content.published_today_aitech', resPublishedTodayAiTech)
  const reelsPublishedTodaybrand = guardCount(dbGuard, 'generated_content.published_today_brand', resPublishedTodaybrand)
  const aiTechTargetMet = targetReelsAiTech > 0 && (reelsPublishedTodayAiTech ?? 0) >= targetReelsAiTech
  const brandTargetMet = targetReelsbrand > 0 && (reelsPublishedTodaybrand ?? 0) >= targetReelsbrand

  // warnings: texto formatado enviado pro Telegram/email (pode ter contadores/IDs).
  // warningCodes: códigos estáveis (nunca interpolam valores voláteis) — usados como
  // chave de dedup, pra um contador mudando de run pra run não derrotar o cooldown
  // (achado na auditoria de 2026-07-10: warnings.join('|') como chave fazia o Telegram
  // reenviar a cada 15min mesmo com a mesma causa raiz, porque os números embutidos
  // quase sempre mudam de um run pro outro).
  const warnings: string[] = []
  const warningCodes: string[] = []
  if (stuckPipelines?.length) {
    warnings.push(`Stuck pipelines: ${stuckPipelines.length}`)
    warningCodes.push('stuck_pipelines')
  }
  if ((recentErrors ?? 0) > 5) {
    warnings.push(`High error rate: ${recentErrors} errors in last hour`)
    warningCodes.push('high_error_rate')
  }
  if ((twitterCreditErrors ?? 0) >= 2 || (publisherCreditErrors ?? 0) > 0) {
    warnings.push(`🔴 Twitter API CREDITS ESGOTADOS — curadoria e publicação X paradas. Renovar em developer.x.com`)
    warningCodes.push('twitter_credits_exhausted')
  }
  if ((xPublishedRecently ?? 0) === 0) {
    warnings.push(`🔴 Nenhum post X publicado nas últimas 12h — pipeline travado ou API com falha`)
    warningCodes.push('x_publish_gap')
  }
  if (igTokenExpired) {
    warnings.push(`🔴 Instagram token EXPIRADO — reels não serão publicados`)
    warningCodes.push('ig_token_expired')
  }
  if (igTokenExpiredbrand) {
    warnings.push(`🔴 @brand: Instagram token EXPIRADO — reels não serão publicados`)
    warningCodes.push('ig_token_expired_brand')
  }
  if (openaiQuotaExceeded) {
    warnings.push(`🔴 OpenAI quota/billing ESGOTADA — geração de capas de reel parada (sem reel_ready). Recarregar conta OpenAI.`)
    warningCodes.push('openai_quota_exceeded')
  }
  if ((anthropicCreditErrors ?? 0) > 0) {
    warnings.push(`🔴 Anthropic API CRÉDITOS ESGOTADOS — reviewer travado, pipeline parado há horas. Recarregar em console.anthropic.com/settings/billing`)
    warningCodes.push('anthropic_credits_exhausted')
  }
  if ((stuckCuratorRuns ?? 0) > 0) {
    warnings.push(`🔴 Curator travado em 'running' há +1h — sem novos conteúdos, pipeline vai secar. Auto-reset na próxima run agendada.`)
    warningCodes.push('curator_stuck')
  }
  if ((failedReels ?? 0) >= 3) {
    warnings.push(`🔴 ${failedReels} reels falharam nas últimas 6h — verificar logs`)
    warningCodes.push('reels_failed')
  }
  if (noCoverCount >= 2) {
    warnings.push(`⚠️ ${noCoverCount} reels sem capa publicados — Gemini pode estar falhando`)
    warningCodes.push('reels_no_cover')
  }
  if (noSubsCount >= 4) {
    warnings.push(`⚠️ ${noSubsCount} reels sem legendas — Railway FFmpeg pode estar falhando`)
    warningCodes.push('reels_no_subs')
  }
  if (noReelsProduced) {
    warnings.push(`⚠️ Nenhum reel produzido nas últimas 24h — checar TWITTERAPI_IO_KEY / credenciais OAuth do X e o serviço reel-renderer no Railway`)
    warningCodes.push('reels_none_produced')
  }
  if ((reelReadyAiTech ?? 0) === 0 && brtHour >= 10 && !aiTechTargetMet) {
    warnings.push(`🔴 ${igHandle}: fila reel_ready VAZIA — nenhum reel será publicado`)
    warningCodes.push('reel_queue_empty_aitech')
  }
  if ((reelReadybrand ?? 0) === 0 && brtHour >= 10 && !brandTargetMet) {
    warnings.push(`🔴 @brand: fila reel_ready VAZIA — nenhum reel será publicado`)
    warningCodes.push('reel_queue_empty_brand')
  }
  if ((stuckPublishing?.length ?? 0) > 0) {
    warnings.push(`🔴 ${stuckPublishing!.length} reel(s) presos em 'publishing' há +30min — publicação travada. IDs: ${stuckPublishing!.map(r => r.id.slice(0, 8)).join(', ')}`)
    warningCodes.push('reels_stuck_publishing')
  }
  if ((failedReelsbrand ?? 0) >= 3) {
    warnings.push(`🔴 @brand: ${failedReelsbrand} reels falharam nas últimas 6h`)
    warningCodes.push('reels_failed_brand')
  }
  // Watchdog vigiando a si mesmo — lição do incidente 42703 (04/07/2026): uma
  // query de monitoramento quebrada deve ALERTAR, nunca cegar checks em silêncio.
  if (dbGuard.failures.length > 0) {
    Sentry.captureException(new Error(`heartbeat db queries failed: ${dbGuard.failures.join(' | ')}`), {
      tags: { cron: 'heartbeat', step: 'db_query_guard' },
    })
    warnings.push(`🔴 Heartbeat: ${dbGuard.failures.length} query(s) de monitoramento FALHARAM — watchdog parcialmente cego. ${dbGuard.failures.join(' | ')}`)
    warningCodes.push('heartbeat_query_error')
  }

  // Minimum reels/day check — runs after 21h BRT (last reel slot at 20h30 BRT)
  // Skipped during pause week ONLY if there's no evidence of a real failure (see above).
  if (brtHour >= 21) {
    try {
      // reelsPublishedTodayAiTech/brand e todayISO já computados acima (guard de meta batida)
      const [settings, settingsbrand] = await Promise.all([
        loadSettings(WORKSPACE_ID),
        loadSettings(brandMOB_WS),
      ])

      if ((reelsPublishedTodayAiTech ?? 0) < settings.min_reels_per_day) {
        warnings.push(`${igHandle}: reels abaixo do mínimo: ${reelsPublishedTodayAiTech ?? 0}/${settings.min_reels_per_day} hoje`)
        warningCodes.push('reels_below_min_aitech')
      }
      if ((reelsPublishedTodaybrand ?? 0) < settingsbrand.min_reels_per_day) {
        warnings.push(`@brand: reels abaixo do mínimo: ${reelsPublishedTodaybrand ?? 0}/${settingsbrand.min_reels_per_day} hoje`)
        warningCodes.push('reels_below_min_brand')
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'heartbeat', step: 'reels_min_check' } })
    }
  }

  // Only alert if there are real warnings (not just quiet hour staleness)
  if (warnings.length > 0) {
    try {
      // Always load from WORKSPACE_ID to ensure cooldown state is stable across runs.
      // Without .eq('id', WORKSPACE_ID), .limit(1).single() returns an arbitrary workspace
      // and the cooldown stored at 10:00 may not be visible at 10:15.
      const workspace = guardData<{ id: string; name: string; telegram_group_id: number | null; brand_config: Record<string, unknown> | null }>(
        dbGuard, 'workspaces.alert_channel', await supabase
        .from('workspaces')
        .select('id, name, telegram_group_id, brand_config')
        .eq('id', WORKSPACE_ID)
        .single())

      // workspace_id filter é obrigatório: existe um agent 'editor-in-chief' por workspace
      // (AI&Tech e Brand) e o de Brand tem telegram_bot_token=null. Sem o filtro,
      // .limit(1).single() pode retornar a linha errada (ordem não é garantida sem ORDER BY)
      // e o alerta de Telegram falha silenciosamente (chatId && botToken vira false, sem erro).
      const editorAgent = guardData<{ telegram_bot_token: string | null }>(
        dbGuard, 'agents.editor_bot_token', await supabase
        .from('agents')
        .select('telegram_bot_token')
        .eq('slug', 'editor-in-chief')
        .eq('workspace_id', WORKSPACE_ID)
        .limit(1)
        .single())

      const brandConfig = workspace?.brand_config ?? {}
      const lastAlertAt = brandConfig.last_heartbeat_alert_at as string | undefined
      const lastWarnings = brandConfig.last_heartbeat_warnings as string | undefined
      const lastEmailAt = brandConfig.last_heartbeat_email_at as string | undefined
      const currentWarningsKey = warningCodes.join('|')
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()

      const sameWarnings = lastWarnings === currentWarningsKey
      const recentAlert = lastAlertAt && lastAlertAt > oneHourAgo

      if (sameWarnings && recentAlert) {
        return NextResponse.json({ ok: false, warnings, skipped: 'dedup_cooldown' })
      }

      // ── Telegram ──
      const chatId = workspace?.telegram_group_id
      const botToken = editorAgent?.telegram_bot_token
      if (chatId && botToken) {
        const alertText = `⚠️ Health Check Alert\n\n${warnings.map(w => `• ${w}`).join('\n')}`
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({ chat_id: chatId, text: alertText }),
          })
        } catch (err) {
          // Best-effort alert — a hung/failed Telegram call must never crash the health check itself.
          console.error('[heartbeat] Telegram alert failed:', err instanceof Error ? err.message : err)
        }
      }

      // ── Email — somente alertas críticos (🔴), cooldown 4h ──
      const criticalWarnings = warnings.filter(w => w.startsWith('🔴'))
      const emailCooldownOk = !lastEmailAt || (now.getTime() - new Date(lastEmailAt).getTime()) >= EMAIL_COOLDOWN_MS
      if (criticalWarnings.length > 0 && emailCooldownOk) {
        const timestamp = now.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
        const content = [
          `## 🔴 Alerta Crítico — Social Machine`,
          `**Horário:** ${timestamp} BRT`,
          ``,
          ...criticalWarnings.map(w => `- ${w}`),
          ...(warnings.filter(w => !w.startsWith('🔴')).length > 0
            ? [``, `**Avisos adicionais:**`, ...warnings.filter(w => !w.startsWith('🔴')).map(w => `- ${w}`)]
            : []),
          ``,
          `*Próxima verificação em 15 minutos. Este email é enviado no máximo 1x a cada 4h para o mesmo alerta.*`,
        ].join('\n')

        await sendReportEmail({
          to: ALERT_EMAIL,
          subject: `🔴 Social Machine — ${criticalWarnings.length} alerta(s) crítico(s) [${timestamp}]`,
          content,
          label: { system: 'Social Machine V3.1', scope: workspace?.name || WORKSPACE_ID },
        }).catch(err => {
          Sentry.captureException(err, { tags: { cron: 'heartbeat', step: 'email_alert' } })
          console.error('[heartbeat] Email alert failed:', err instanceof Error ? err.message : err)
        })
      }

      // Update cooldown state
      if (workspace?.id) {
        await supabase
          .from('workspaces')
          .update({
            brand_config: {
              ...brandConfig,
              last_heartbeat_alert_at: now.toISOString(),
              last_heartbeat_warnings: currentWarningsKey,
              ...(criticalWarnings.length > 0 && emailCooldownOk ? { last_heartbeat_email_at: now.toISOString() } : {}),
            },
          })
          .eq('id', workspace.id)
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { cron: 'heartbeat', step: 'telegram_alert' } })
      console.error('[heartbeat] Alert failed:', err instanceof Error ? err.message : err)
    }
  }

  return NextResponse.json({
    ok: warnings.length === 0,
    timestamp: now.toISOString(),
    warnings,
    stats: {
      staleAgents: 0,
      stuckPipelines: stuckPipelines?.length ?? 0,
      recentErrors: recentErrors ?? 0,
      failedReels: failedReels ?? 0,
      reelsWithoutCover: noCoverCount,
      reelsWithoutSubs: noSubsCount,
      igTokenExpired,
      igTokenExpiredbrand,
      openaiQuotaExceeded,
      twitterCreditsError: (twitterCreditErrors ?? 0) > 0 || (publisherCreditErrors ?? 0) > 0,
      anthropicCreditsError: (anthropicCreditErrors ?? 0) > 0,
      xPublishedLast12h: xPublishedRecently ?? 0,
      reelsProduced24h: recentReelRuns?.length ?? 0,
      reelReadyAiTech: reelReadyAiTech ?? 0,
      reelReadybrand: reelReadybrand ?? 0,
      stuckPublishing: stuckPublishing?.length ?? 0,
      dbQueryFailures: dbGuard.failures.length,
    },
  })
}
