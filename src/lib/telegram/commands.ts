import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { sendMessage } from './bot-manager'

export interface CommandContext {
  command: string
  args: string[]
  chatId: number
  fromUserId: number
  fromUsername?: string
  agentSlug: string
  botToken: string
}

type CommandHandler = (ctx: CommandContext) => Promise<string>

const commands: Record<string, CommandHandler> = {
  status: handleStatus,
  run: handleRun,
  pause: handlePause,
  resume: handleResume,
  pipeline: handlePipeline,
  topics: handleTopics,
  article: handleArticle,
  report: handleReport,
  help: handleHelp,
}

export async function executeCommand(ctx: CommandContext): Promise<void> {
  const handler = commands[ctx.command]
  if (!handler) return

  const response = await handler(ctx)
  if (response) {
    await sendMessage(ctx.botToken, ctx.chatId, response)
  }
}

export function parseCommand(text: string): { command: string; args: string[] } | null {
  if (!text.startsWith('/')) return null
  const parts = text.split(' ')
  const command = parts[0].replace(/^\//, '').replace(/@\w+$/, '').toLowerCase()
  return { command, args: parts.slice(1) }
}

async function handleStatus(_ctx: CommandContext): Promise<string> {
  const supabase = getAdminClient()
  const { data: agents } = await supabase
    .from('agents')
    .select('slug, name, active, schedule_enabled, last_run_at, total_runs, avg_score')
    .order('slug')

  if (!agents?.length) return '📭 Nenhum agente configurado.'

  const lines = agents.map((a: Record<string, unknown>) => {
    const active = a.active ? '🟢' : '🔴'
    const scheduled = a.schedule_enabled ? '⏰' : '⏸️'
    const lastRun = a.last_run_at
      ? `${Math.round((Date.now() - new Date(a.last_run_at as string).getTime()) / 60000)}min`
      : 'never'
    const score = a.avg_score ? ` | score: ${Number(a.avg_score).toFixed(1)}` : ''
    return `${active}${scheduled} *${a.name}* — runs: ${a.total_runs}, last: ${lastRun}${score}`
  })

  return `📊 *Status dos Agentes*\n\n${lines.join('\n')}`
}

async function handleRun(ctx: CommandContext): Promise<string> {
  const targetSlug = ctx.args[0]
  if (!targetSlug) return '⚠️ Uso: /run <agent-slug>'

  const baseUrl = getBaseUrl()

  // Find workspace for this agent
  const supabase = getAdminClient()
  const { data: agent } = await supabase
    .from('agents')
    .select('workspace_id')
    .eq('slug', targetSlug)
    .single()

  if (!agent) return `❌ Agente '${targetSlug}' não encontrado.`

  // Fire-and-forget — don't await, agent execution takes 10-30s
  // The agent will post its own Telegram report when done
  fetch(`${baseUrl}/api/agents/${targetSlug}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({
      workspaceId: agent.workspace_id,
      trigger: 'telegram',
    }),
  }).catch(err => console.error(`[commands] Fire-and-forget /run ${targetSlug} failed:`, err))

  return `🚀 Agente *${targetSlug}* disparado. Aguarde o relatório...`
}

async function handlePause(ctx: CommandContext): Promise<string> {
  const targetSlug = ctx.args[0]
  if (!targetSlug) return '⚠️ Uso: /pause <agent-slug>'

  const supabase = getAdminClient()
  const { error } = await supabase
    .from('agents')
    .update({ schedule_enabled: false })
    .eq('slug', targetSlug)

  return error
    ? `❌ Erro ao pausar: ${error.message}`
    : `⏸️ Agente *${targetSlug}* pausado.`
}

async function handleResume(ctx: CommandContext): Promise<string> {
  const targetSlug = ctx.args[0]
  if (!targetSlug) return '⚠️ Uso: /resume <agent-slug>'

  const supabase = getAdminClient()
  const { error } = await supabase
    .from('agents')
    .update({ schedule_enabled: true })
    .eq('slug', targetSlug)

  return error
    ? `❌ Erro ao retomar: ${error.message}`
    : `▶️ Agente *${targetSlug}* retomado.`
}

async function handlePipeline(ctx: CommandContext): Promise<string> {
  const supabase = getAdminClient()
  const { data: runs } = await supabase
    .from('pipeline_runs')
    .select('id, status, started_at, completed_at, stages_completed, trigger')
    .order('created_at', { ascending: false })
    .limit(5)

  if (!runs?.length) return '📭 Nenhuma execução de pipeline encontrada.'

  const lines = runs.map((r: Record<string, unknown>) => {
    const status = r.status === 'completed' ? '✅' : r.status === 'running' ? '🔄' : '❌'
    const stages = (r.stages_completed as string[])?.length ?? 0
    const duration = r.completed_at && r.started_at
      ? `${Math.round((new Date(r.completed_at as string).getTime() - new Date(r.started_at as string).getTime()) / 1000)}s`
      : 'running...'
    return `${status} ${(r.trigger as string)} — ${stages} stages — ${duration}`
  })

  return `🔄 *Pipeline Runs (últimas 5)*\n\n${lines.join('\n')}`
}

async function handleTopics(ctx: CommandContext): Promise<string> {
  const supabase = getAdminClient()
  const { data: topics } = await supabase
    .from('trending_topics')
    .select('title, relevance, status, detected_at')
    .order('detected_at', { ascending: false })
    .limit(10)

  if (!topics?.length) return '📭 Nenhum trending topic detectado ainda.'

  const emoji: Record<string, string> = { alta: '🔴', media: '🟡', baixa: '🟢' }
  const lines = topics.map((t: Record<string, unknown>) => {
    const rel = emoji[t.relevance as string] ?? '⚪'
    return `${rel} *${t.title}* (${t.status})`
  })

  return `📈 *Trending Topics (últimos 10)*\n\n${lines.join('\n')}`
}

async function handleArticle(ctx: CommandContext): Promise<string> {
  const supabase = getAdminClient()

  // Find workspace
  const { data: agent } = await supabase
    .from('agents')
    .select('workspace_id')
    .eq('slug', 'writer')
    .single()

  if (!agent) return '❌ Writer agent não encontrado.'

  // Fire and forget via dedicated API route (maxDuration=300s)
  const baseUrl = getBaseUrl()
  fetch(`${baseUrl}/api/article`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({
      workspaceId: agent.workspace_id,
      model: 'deepseek-chat',
      telegramChatId: ctx.chatId,
      telegramBotToken: ctx.botToken,
    }),
  }).catch(err => console.error('[article] API call failed:', err))

  return '📝 Gerando artigo para X Articles... Aguarde ~60s, o artigo completo sera postado aqui.'
}

async function handleReport(_ctx: CommandContext): Promise<string> {
  const supabase = getAdminClient()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Publications last 24h by platform
  const { data: published } = await supabase
    .from('generated_content')
    .select('target_platform')
    .eq('status', 'published')
    .gte('published_at', since24h)

  const pubByPlatform: Record<string, number> = {}
  for (const row of published ?? []) {
    pubByPlatform[row.target_platform] = (pubByPlatform[row.target_platform] ?? 0) + 1
  }

  // Pipeline status counts
  const statusLabels: Array<{ status: string; label: string; emoji: string }> = [
    { status: 'approved', label: 'aprovados', emoji: '🟡' },
    { status: 'published', label: 'publicados (total)', emoji: '✅' },
    { status: 'rejected', label: 'rejeitados', emoji: '❌' },
    { status: 'failed', label: 'falhos (permanente)', emoji: '🔴' },
  ]
  const statusCounts: Record<string, number> = {}
  for (const { status } of statusLabels) {
    const { count } = await supabase
      .from('generated_content')
      .select('*', { count: 'exact', head: true })
      .eq('status', status) as { count: number | null }
    statusCounts[status] = count ?? 0
  }

  // Token usage + cost last 24h (agent_actions uses agent_id, not agent_slug)
  const { data: actions } = await supabase
    .from('agent_actions')
    .select('tokens_used, cost_estimate, status')
    .gte('created_at', since24h)

  const totalTokens = (actions ?? []).reduce((s, a) => s + (a.tokens_used ?? 0), 0)
  const totalCost = (actions ?? []).reduce((s, a) => s + (a.cost_estimate ?? 0), 0)
  const totalActions = (actions ?? []).length
  const totalErrors = (actions ?? []).filter(a => a.status === 'error').length

  // Topics discovered today
  const { count: topicsToday } = await supabase
    .from('trending_topics')
    .select('*', { count: 'exact', head: true })
    .gte('detected_at', since24h) as { count: number | null }

  // Agent avg scores
  const { data: agents } = await supabase
    .from('agents')
    .select('name, avg_score, total_runs')
    .eq('active', true)
    .not('avg_score', 'is', null)
    .order('avg_score', { ascending: false })
    .limit(5)

  const platformIcons: Record<string, string> = { x: '🐦', instagram: '📸', linkedin: '💼' }

  const lines: string[] = [
    '📊 *Social Machine — Report 24h*',
    '',
    '📤 *Publicações (últimas 24h)*',
    Object.keys(pubByPlatform).length
      ? Object.entries(pubByPlatform).map(([p, n]) => `  ${platformIcons[p] ?? '📤'} ${p}: ${n}`).join('\n')
      : '  Nenhuma publicação registrada',
    '',
    '🗂 *Pipeline (acumulado)*',
    ...statusLabels.map(({ status, label, emoji }) => `  ${emoji} ${label}: ${statusCounts[status]}`),
    '',
    `🤖 *AI (últimas 24h)*`,
    `  Ações: ${totalActions} (${totalErrors} erros)`,
    `  Tokens: ${(totalTokens / 1000).toFixed(1)}k`,
    `  Custo: $${totalCost.toFixed(3)} USD`,
    '',
    `📈 *Topics detectados hoje:* ${topicsToday ?? 0}`,
    '',
    '🏅 *Scores dos agentes*',
    ...(agents ?? []).map(a => `  ${a.name}: ${Number(a.avg_score).toFixed(1)}/10 (${a.total_runs} runs)`),
  ].filter(l => l !== undefined && l !== null)

  return lines.join('\n')
}

async function handleHelp(_ctx: CommandContext): Promise<string> {
  return [
    '🤖 *Social Machine v2 — Comandos*\n',
    '/status — Status de todos os agentes',
    '/run <slug> — Executar um agente manualmente',
    '/pause <slug> — Pausar schedule de um agente',
    '/resume <slug> — Retomar schedule de um agente',
    '/pipeline — Últimas execuções do pipeline',
    '/topics — Trending topics recentes',
    '/article — Gerar artigo longo para X Articles',
    '/report — Analytics: publicações, pipeline, custos, scores',
    '/help — Esta mensagem',
  ].join('\n')
}
