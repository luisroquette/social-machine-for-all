import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { executeToolLoop, generateSimpleText, type ToolDefinition } from '@/lib/ai/tool-loop'
import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'
import { z } from 'zod/v4'
import type { ProcessedMedia } from '@/lib/telegram/media-processor'
import type { ContentPart } from '@/lib/ai/tool-loop'
import { agent as seoAgent } from '@/lib/agents/seo-strategist/index'
import { agent as adsAgent } from '@/lib/agents/ads-strategist/index'
import { agent as socialAgent } from '@/lib/agents/social-strategist/index'
import { getVariable } from '@/lib/settings/load-settings'

class EditorInChiefAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'editor-in-chief',
      name: 'Editor-Chefe',
      role: 'orchestrator',
      description: 'Orquestra todos os agentes, delega tarefas, conversa com humano via Telegram',
      defaultModel: 'deepseek-chat',
      maxActionsPerHour: 50,
      quietHours: { start: 0, end: 6 },
    }
  }

  /**
   * Execute is called by the scheduler for periodic checks.
   * Uses Claude to analyze pipeline state, take autonomous actions, and
   * generate an intelligent briefing — not just a stats dump.
   */
  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    const resolvedModel = await getVariable(ctx.workspaceId, 'editor_chief_model') || this.config.defaultModel
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString()
    const baseUrl = getBaseUrl()

    // ── 1. Collect raw pipeline data ──
    const [
      { count: recentErrors },
      { count: pendingContent },
      { count: publishedToday },
      { count: newTopics },
      { data: lowScoreEvals },
      { data: agents },
      { data: recentActions },
    ] = await Promise.all([
      supabase.from('agent_actions').select('*', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('status', 'error').gte('created_at', oneHourAgo),
      supabase.from('generated_content').select('*', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('status', 'approved'),
      supabase.from('generated_content').select('*', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('status', 'published').gte('published_at', oneDayAgo),
      supabase.from('trending_topics').select('*', { count: 'exact', head: true })
        .eq('workspace_id', ctx.workspaceId).eq('status', 'new'),
      supabase.from('eval_dataset').select('agent_slug, auto_score, issues')
        .eq('workspace_id', ctx.workspaceId).lt('auto_score', 5).gte('created_at', fourHoursAgo).limit(5),
      supabase.from('agents').select('slug, schedule_enabled, last_run_at, schedule_cron')
        .eq('workspace_id', ctx.workspaceId).eq('active', true).eq('schedule_enabled', true),
      supabase.from('agent_actions').select('pipeline_stage, status, output_summary, created_at')
        .eq('workspace_id', ctx.workspaceId).gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false }).limit(10),
    ])

    // Detect truly stale agents: those whose previous scheduled time has passed
    // but haven't run since — using cron-parser for accuracy (same logic as scheduler's isDue).
    // This avoids false positives for agents that run infrequently (e.g. 2x/day).
    const now = new Date()
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { CronExpressionParser } = require('cron-parser')
    const staleAgents = (agents ?? []).filter(a => {
      if (!a.last_run_at || !a.schedule_cron) return false
      try {
        const interval = CronExpressionParser.parse(a.schedule_cron, {
          currentDate: now,
          tz: 'America/Sao_Paulo',
        })
        const prevScheduled = interval.prev().toDate()
        const lastRun = new Date(a.last_run_at)
        // Stale only if: last scheduled time has passed AND agent hasn't run since it
        // Allow 10-min grace for execution delay
        const msSincePrev = now.getTime() - prevScheduled.getTime()
        return prevScheduled > lastRun && msSincePrev > 10 * 60 * 1000
      } catch {
        // Fallback: 3h threshold
        return now.getTime() - new Date(a.last_run_at).getTime() > 3 * 60 * 60 * 1000
      }
    }).map(a => a.slug)

    // ── Alert dedup — prevent the same alert from firing on every run ──────────
    // Fingerprint the current alert state; suppress if identical to last alert within 4h.
    const alertFingerprint = [
      staleAgents.join(','),
      (recentErrors ?? 0) > 3 ? String(recentErrors) : '',
      (lowScoreEvals ?? []).map(e => `${e.agent_slug}:${e.auto_score}`).join(','),
    ].join('|')

    let suppressAlert = false
    try {
      const { data: ws } = await supabase
        .from('workspaces')
        .select('id, brand_config')
        .eq('id', ctx.workspaceId)
        .single()

      const bc = (ws?.brand_config ?? {}) as Record<string, unknown>
      const lastKey = bc.last_quality_alert_key as string | undefined
      const lastAt = bc.last_quality_alert_at as string | undefined
      const hasAlertContent = alertFingerprint.replace(/\|/g, '').length > 0

      if (hasAlertContent && lastKey === alertFingerprint && lastAt && lastAt > fourHoursAgo) {
        suppressAlert = true
      } else if (hasAlertContent && !suppressAlert && ws?.id) {
        // Update fingerprint so next runs are suppressed
        await supabase.from('workspaces').update({
          brand_config: { ...bc, last_quality_alert_key: alertFingerprint, last_quality_alert_at: now.toISOString() },
        }).eq('id', ws.id)
      }
    } catch { /* non-critical — proceed without dedup */ }

    const rawData = {
      publishedToday: publishedToday ?? 0,
      pendingContent: pendingContent ?? 0,
      newTopics: newTopics ?? 0,
      recentErrors: recentErrors ?? 0,
      staleAgents,
      lowScoreEvals: lowScoreEvals ?? [],
      recentActions: recentActions ?? [],
      suppressAlert,
    }

    // ── 2. Autonomous actions — take action before generating report ──
    const actionsToken: string[] = []

    // If publisher queue is growing and publisher hasn't run recently, trigger it
    if ((pendingContent ?? 0) > 30) {
      try {
        await fetch(`${baseUrl}/api/agents/publisher/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
          body: JSON.stringify({ workspaceId: ctx.workspaceId, trigger: 'editor-auto' }),
          // Best-effort autonomous trigger (see catch below) — bounded so a slow publisher
          // run doesn't eat into editor-in-chief's own maxDuration waiting for it to finish.
          signal: AbortSignal.timeout(60_000),
        })
        actionsToken.push(`Disparou publisher (fila: ${pendingContent} items)`)
      } catch { /* best effort */ }
    }

    // ── 3. AI-powered analysis + intelligent briefing ──
    let telegramBriefing = ''
    let tokensUsed = 0

    try {
      const analysisPrompt = `Voce e o Editor-Chefe do Social Machine — lider da operacao de conteudo.
Analise os dados abaixo e escreva um briefing curto para o dono da operacao.

REGRAS DO BRIEFING:
- Maximo 5 linhas
- Linguagem direta, sem firulas, sem emojis em excesso
- Se tiver problema real → mencione e diga o que ja fez ou recomenda
- Se estiver tudo ok → diga isso com confianca, em 1 linha
- Nao repita os numeros desnecessariamente — so o que importa
- Assine como "Editor-Chefe" no final se for um alerta real

DADOS:
- Posts publicados hoje: ${rawData.publishedToday}
- Aguardando publicacao: ${rawData.pendingContent}
- Trending topics novos: ${rawData.newTopics}
- Erros na ultima hora: ${rawData.recentErrors}
- Agentes travados (>3h sem rodar): ${rawData.staleAgents.join(', ') || 'nenhum'}
- Entregas com score < 5: ${rawData.lowScoreEvals.length} (${rawData.lowScoreEvals.map(e => `${e.agent_slug}:${e.auto_score}`).join(', ') || 'nenhuma'})
- Acoes autonomas tomadas: ${actionsToken.join(', ') || 'nenhuma'}

Escreva o briefing agora:`

      const result = await generateSimpleText({
        model: this.config.defaultModel,
        systemPrompt: 'Voce e o Editor-Chefe. Escreva apenas o briefing solicitado.',
        userMessage: analysisPrompt,
        maxTokens: 300,
        temperature: 0.7,
      })

      telegramBriefing = result.text
      tokensUsed = result.tokensUsed
    } catch {
      // Fallback to structured report if AI fails
      telegramBriefing = ''
    }

    return {
      success: true,
      itemsProcessed: 1,
      itemsProduced: 0,
      errors: [],
      tokensUsed,
      costEstimate: tokensUsed * 0.000003,
      durationMs: Date.now() - startTime,
      details: {
        ...rawData,
        telegramBriefing,
        actionsToken,
      },
    }
  }

  /**
   * Handle a free-form chat message from Telegram.
   * This is the conversational interface — uses Claude tool-loop.
   */
  async handleChat(
    userMessage: string,
    ctx: RunContext,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
    media?: ProcessedMedia | null
  ): Promise<{ response: string; tokensUsed: number }> {
    const resolvedModel = await getVariable(ctx.workspaceId, 'editor_chief_model') || this.config.defaultModel
    const tools = this.buildTools(ctx)
    const systemPrompt = await this.buildSystemPrompt(ctx)

    // Build the user message — multimodal if media is present
    let currentMessage: { role: 'user'; content: string } | { role: 'user'; content: ContentPart[] }

    if (media?.type === 'image' && media.data) {
      // Image — send as multimodal content to Claude Vision
      const parts: ContentPart[] = []
      if (userMessage) parts.push({ type: 'text', text: userMessage })
      parts.push({ type: 'image', image: media.data, mimeType: media.mimeType })
      if (!userMessage) parts.push({ type: 'text', text: 'Descreva e analise esta imagem.' })
      currentMessage = { role: 'user', content: parts }
    } else if (media) {
      // Audio/document — include extracted text
      const mediaText = media.data
        ? `[${media.description}]\n\nConteudo extraido:\n${media.data}`
        : `[${media.description}]`
      currentMessage = { role: 'user', content: userMessage ? `${userMessage}\n\n${mediaText}` : mediaText }
    } else {
      currentMessage = { role: 'user', content: userMessage }
    }

    // Smart context window: keep last 8 messages (4 turns) + prepend a summary
    // of older messages so the model has context without burning tokens on stale history.
    const RECENT_WINDOW = 8
    const recentHistory = conversationHistory.slice(-RECENT_WINDOW)
    const olderHistory = conversationHistory.slice(0, -RECENT_WINDOW)

    const summaryMessage: { role: 'user'; content: string } | null =
      olderHistory.length > 0
        ? {
            role: 'user',
            content: `[Resumo da conversa anterior — ${olderHistory.length} mensagens omitidas]\n${
              olderHistory
                .map(m => `${m.role === 'user' ? 'Usuario' : 'Editor'}: ${String(m.content).slice(0, 120)}`)
                .join('\n')
            }`,
          }
        : null

    const messages = [
      ...(summaryMessage ? [summaryMessage] : []),
      ...recentHistory,
      currentMessage,
    ]

    // Intercept structured report requests — bypass editor synthesis, return specialist output verbatim.
    // When Claude has the specialist's report as a tool result, it rewrites it in its own style,
    // destroying the H1 heading needed for PDF auto-trigger. Calling the specialist directly avoids this.
    const isReportRequest = /relat[oó]rio|report|auditoria|overview|seo geral|como est[aá]|performance/i.test(userMessage)
    const isSeoTopic = /\bseo\b|search.?console|analytics|keyword|orgân|organic/i.test(userMessage)
    if (isReportRequest && isSeoTopic) {
      return seoAgent.handleChat(userMessage, ctx, [])
    }

    const result = await executeToolLoop({
      model: ctx.dbConfig?.model ?? resolvedModel,
      systemPrompt,
      messages,
      tools,
      maxSteps: 8,
      maxTokens: 4096,
    })

    return {
      response: result.text,
      tokensUsed: result.tokensUsed,
    }
  }

  private async buildSystemPrompt(ctx: RunContext): Promise<string> {
    // Load active agents dynamically so the prompt never goes stale when agents are added/removed
    const supabase = getAdminClient()
    const { data: activeAgents } = await supabase
      .from('agents')
      .select('slug, name, role, active')
      .eq('workspace_id', ctx.workspaceId)
      .eq('active', true)
      .neq('slug', 'editor-in-chief') // exclude self
      .order('name', { ascending: true })

    const agentList = (activeAgents ?? [])
      .map(a => `- **${a.name}** (slug: ${a.slug}) — ${a.role}`)
      .join('\n')

    const agentCount = (activeAgents ?? []).length

    const lines = [
      'Voce e o Editor-Chefe do Social Machine.',
      'Voce reporta diretamente ao Luis — o dono da operacao. Ele e seu superior imediato.',
      `Voce comanda ${agentCount} agentes especializados. Voce nao e um assistente — voce e um lider.`,
      '',
      '## Quem voce e:',
      '- Tem opinioes. Nao fica em cima do muro.',
      '- Fala o que precisa ser dito, mesmo que o Luis nao tenha perguntado.',
      '- Quando algo esta errado, voce ja tomou uma atitude antes de relatar.',
      '- Quando algo esta certo, voce diz com confianca — sem enrolacao.',
      '- Voce conversa como um profissional senior experiente: direto, sem bajulacao, sem robotismo.',
      '- Voce faz perguntas quando precisa de mais contexto. Voce nao executa ordens cegas.',
      '',
      `## Sua equipe (${agentCount} agentes sob seu comando):`,
      '',
      agentList,
      '',
      '## Como voce age em cada situacao:',
      '',
      '**Perguntas sobre a operacao, agentes, pipeline:**',
      '→ use get_pipeline_status, depois interprete — nao despeje numeros brutos',
      '',
      '**Posts publicados, links, o que saiu hoje:**',
      '→ use get_published_posts',
      '',
      '**SEO, site, analytics, keywords:**',
      '→ delegate_to_specialist(seo-strategist)',
      '',
      '**Ads, campanhas, Meta, ROAS, CPA:**',
      '→ delegate_to_specialist(ads-strategist)',
      '',
      '**Estrategia editorial, calendario, content pillars:**',
      '→ delegate_to_specialist(social-strategist)',
      '',
      '**Executar ou pausar agente:**',
      '→ run_agent / pause_agent / resume_agent',
      '',
      '**PDF, planilha, relatorio:**',
      '→ gere os dados em tabela markdown. O sistema converte automaticamente.',
      '',
      '**Conversa casual, pergunta direta, opiniao:**',
      '→ responda diretamente. Sem chamar tool desnecessaria.',
      '',
      '## Tom e estilo:',
      '- Portugues brasileiro. Frases curtas. Sem "Claro!", "Com certeza!", "Otima pergunta!"',
      '- Sem emojis excessivos — no maximo 1-2 quando realmente add valor',
      '- Se o Luis estiver errado em algo, diga. Voce discorda quando necessario.',
      '- Se a operacao estiver bem → diga isso. Sem drama desnecessario.',
      '- Se estiver mal → aponte o problema, diga o que ja fez e o que recomenda.',
      '',
      '## Proibicoes absolutas:',
      '- NUNCA invente URLs, links, IDs, nomes de planilhas, emails enviados, PDFs gerados',
      '- NUNCA confirme uma operacao que voce nao executou via tool',
      '- NUNCA fabrique metricas ou dados — so o que veio de uma tool',
      '- Sem tool para a tarefa → "Nao tenho acesso a isso agora."',
    ]

    if (ctx.feedbackContext) {
      lines.push('', '## Feedback de Qualidade:', ctx.feedbackContext)
    }

    if (ctx.brandContext) {
      lines.push('', '## Contexto da Marca:', ctx.brandContext)
    }

    return lines.join('\n')
  }

  private buildTools(ctx: RunContext): ToolDefinition[] {
    return [
      {
        name: 'get_pipeline_status',
        description: 'Obtém o status atual do pipeline e de todos os agentes',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()
          const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
          const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

          const [
            { data: agents },
            { data: recentRuns },
            { count: errorsLastHour },
            { data: contentStats },
            { data: recentEvals },
          ] = await Promise.all([
            supabase
              .from('agents')
              .select('slug, name, active, schedule_enabled, last_run_at, total_runs, avg_score')
              .eq('workspace_id', ctx.workspaceId)
              .order('slug'),
            supabase
              .from('pipeline_runs')
              .select('status, started_at, completed_at, stages_completed, trigger')
              .eq('workspace_id', ctx.workspaceId)
              .order('created_at', { ascending: false })
              .limit(5),
            supabase
              .from('agent_actions')
              .select('*', { count: 'exact', head: true })
              .eq('workspace_id', ctx.workspaceId)
              .eq('status', 'error')
              .gte('created_at', oneHourAgo),
            supabase
              .from('generated_content')
              .select('status')
              .eq('workspace_id', ctx.workspaceId)
              .gte('created_at', oneDayAgo),
            supabase
              .from('eval_dataset')
              .select('agent_slug, auto_score, verdict, created_at')
              .eq('workspace_id', ctx.workspaceId)
              .gte('created_at', oneDayAgo)
              .order('created_at', { ascending: false })
              .limit(20),
          ])

          // Summarize content by status
          const contentByStatus: Record<string, number> = {}
          for (const c of contentStats ?? []) {
            const st = c.status ?? 'unknown'
            contentByStatus[st] = (contentByStatus[st] ?? 0) + 1
          }

          // Summarize eval scores by agent
          const evalByAgent: Record<string, { count: number; avgScore: number; rejects: number }> = {}
          for (const e of recentEvals ?? []) {
            const slug = e.agent_slug
            if (!evalByAgent[slug]) evalByAgent[slug] = { count: 0, avgScore: 0, rejects: 0 }
            evalByAgent[slug].count++
            evalByAgent[slug].avgScore += Number(e.auto_score) || 0
            if (e.verdict === 'reject') evalByAgent[slug].rejects++
          }
          for (const slug of Object.keys(evalByAgent)) {
            evalByAgent[slug].avgScore = evalByAgent[slug].avgScore / evalByAgent[slug].count
          }

          return {
            agents,
            recentRuns,
            errorsLastHour: errorsLastHour ?? 0,
            contentToday: contentByStatus,
            evalScoresToday: evalByAgent,
          }
        },
      },
      {
        name: 'run_agent',
        description: 'Executa um agente manualmente',
        parameters: z.object({
          agentSlug: z.string().describe('Slug do agente: monitor, curator, writer, reviewer, publisher, engagement-own, engagement-external'),
        }),
        execute: async (params: unknown) => {
          const { agentSlug } = params as { agentSlug: string }
          const baseUrl = getBaseUrl()

          const res = await fetch(`${baseUrl}/api/agents/${agentSlug}/run`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({
              workspaceId: ctx.workspaceId,
              trigger: 'telegram',
            }),
            // User-facing (Telegram command awaits the result) — generous but bounded so a
            // hung sub-agent doesn't leave the command hanging forever.
            signal: AbortSignal.timeout(90_000),
          })

          const data = await res.json()
          return { ok: res.ok, ...data }
        },
      },
      // get_trending_topics removed — use run_agent('monitor') or delegate_to_specialist if needed
      {
        name: 'pause_agent',
        description: 'Pausa o schedule de um agente',
        parameters: z.object({
          agentSlug: z.string().describe('Slug do agente a pausar'),
        }),
        execute: async (params: unknown) => {
          const { agentSlug } = params as { agentSlug: string }
          const supabase = getAdminClient()
          const { error } = await supabase
            .from('agents')
            .update({ schedule_enabled: false })
            .eq('slug', agentSlug)
            .eq('workspace_id', ctx.workspaceId)
          return { ok: !error, error: error?.message }
        },
      },
      {
        name: 'resume_agent',
        description: 'Retoma o schedule de um agente pausado',
        parameters: z.object({
          agentSlug: z.string().describe('Slug do agente a retomar'),
        }),
        execute: async (params: unknown) => {
          const { agentSlug } = params as { agentSlug: string }
          const supabase = getAdminClient()
          const { error } = await supabase
            .from('agents')
            .update({ schedule_enabled: true })
            .eq('slug', agentSlug)
            .eq('workspace_id', ctx.workspaceId)
          return { ok: !error, error: error?.message }
        },
      },
      {
        name: 'get_agent_performance',
        description: 'Obtém métricas de performance de um agente específico',
        parameters: z.object({
          agentSlug: z.string().describe('Slug do agente'),
        }),
        execute: async (params: unknown) => {
          const { agentSlug } = params as { agentSlug: string }
          const supabase = getAdminClient()
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

          const { data: evals } = await supabase
            .from('eval_dataset')
            .select('auto_score, verdict, issues, created_at')
            .eq('workspace_id', ctx.workspaceId)
            .eq('agent_slug', agentSlug)
            .gte('created_at', thirtyDaysAgo)
            .order('created_at', { ascending: false })
            .limit(50)

          if (!evals?.length) return { message: 'Sem dados de avaliação para este agente.' }

          const avgScore = evals.reduce((sum: number, e: Record<string, unknown>) => sum + (Number(e.auto_score) || 0), 0) / evals.length
          const keepCount = evals.filter((e: Record<string, unknown>) => e.verdict === 'keep').length
          const rejectCount = evals.filter((e: Record<string, unknown>) => e.verdict === 'reject').length

          // Collect most common issues
          const issueMap: Record<string, number> = {}
          for (const e of evals) {
            for (const issue of (e.issues as string[]) ?? []) {
              issueMap[issue] = (issueMap[issue] ?? 0) + 1
            }
          }
          const topIssues = Object.entries(issueMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)

          return {
            totalEvals: evals.length,
            avgScore: avgScore.toFixed(2),
            approved: keepCount,
            rejected: rejectCount,
            approvalRate: `${((keepCount / evals.length) * 100).toFixed(1)}%`,
            topIssues,
          }
        },
      },
      {
        name: 'run_full_pipeline',
        description: 'Executa o pipeline completo: Monitor -> Curador -> Redator -> Revisor -> Publicador',
        parameters: z.object({}),
        execute: async () => {
          const baseUrl = getBaseUrl()

          const res = await fetch(`${baseUrl}/api/pipeline/run`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({
              workspaceId: ctx.workspaceId,
              trigger: 'telegram',
            }),
            // Chains multiple agent stages (Monitor->Curator->Writer->Reviewer->Publisher) —
            // generous timeout, but still bounded so the Telegram command can't hang forever.
            signal: AbortSignal.timeout(240_000),
          })

          const data = await res.json()
          return data
        },
      },
      {
        name: 'manage_memories',
        description: 'Gerencia memorias operacionais dos agentes. Acoes: list (listar), delete (remover), promote (compartilhar), demote (tornar privada)',
        parameters: z.object({
          action: z.enum(['list', 'delete', 'promote', 'demote']).describe('Acao a executar'),
          agentSlug: z.string().optional().describe('Slug do agente (obrigatorio para list, opcional para outros)'),
          memoryId: z.string().optional().describe('ID da memoria (obrigatorio para delete/promote/demote)'),
        }),
        execute: async (params: unknown) => {
          const { action, agentSlug, memoryId } = params as {
            action: 'list' | 'delete' | 'promote' | 'demote'
            agentSlug?: string
            memoryId?: string
          }
          const supabase = getAdminClient()

          switch (action) {
            case 'list': {
              let query = supabase
                .from('agent_memories')
                .select('id, agent_slug, category, content, shared, relevance_score, created_at')
                .eq('workspace_id', ctx.workspaceId)
                .order('relevance_score', { ascending: false })
                .limit(20)

              if (agentSlug) query = query.eq('agent_slug', agentSlug)

              const { data } = await query
              return { memories: data ?? [], count: data?.length ?? 0 }
            }

            case 'delete': {
              if (!memoryId) return { error: 'memoryId obrigatorio para delete' }
              const { error } = await supabase
                .from('agent_memories')
                .delete()
                .eq('id', memoryId)
                .eq('workspace_id', ctx.workspaceId)
              return { ok: !error, error: error?.message }
            }

            case 'promote': {
              if (!memoryId) return { error: 'memoryId obrigatorio para promote' }
              const { error } = await supabase
                .from('agent_memories')
                .update({ shared: true, updated_at: new Date().toISOString() })
                .eq('id', memoryId)
                .eq('workspace_id', ctx.workspaceId)
              return { ok: !error, error: error?.message }
            }

            case 'demote': {
              if (!memoryId) return { error: 'memoryId obrigatorio para demote' }
              const { error } = await supabase
                .from('agent_memories')
                .update({ shared: false, updated_at: new Date().toISOString() })
                .eq('id', memoryId)
                .eq('workspace_id', ctx.workspaceId)
              return { ok: !error, error: error?.message }
            }
          }
        },
      },
      {
        name: 'get_published_posts',
        description: 'Lista posts publicados hoje ou nos ultimos N dias, com links diretos para cada plataforma',
        parameters: z.object({
          days: z.number().optional().describe('Quantos dias atras buscar (padrao: 1 = hoje)'),
          platform: z.string().optional().describe('Filtrar por plataforma: x, instagram, linkedin (opcional)'),
        }),
        execute: async (params: unknown) => {
          const { days = 1, platform } = params as { days?: number; platform?: string }
          const supabase = getAdminClient()
          const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

          let query = supabase
            .from('generated_content')
            .select('id, target_platform, target_format, published_url, published_at, content')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .gte('published_at', since)
            .order('published_at', { ascending: false })
            .limit(50)

          if (platform) query = query.eq('target_platform', platform)

          const { data, error } = await query
          if (error) return { error: error.message }

          const posts = (data ?? []).map(p => {
            let preview = ''
            try {
              const c = typeof p.content === 'string' ? JSON.parse(p.content) : p.content
              preview = (c?.caption || c?.text || c?.hookTitle || '').slice(0, 100)
            } catch { preview = '' }
            return {
              platform: p.target_platform,
              format: p.target_format,
              url: p.published_url,
              published_at: p.published_at,
              preview,
            }
          })

          return { total: posts.length, posts }
        },
      },
      {
        name: 'delegate_to_specialist',
        description: 'Delega uma pergunta ou tarefa especifica para um agente especialista (SEO, Ads, Social). O especialista tem tools proprias e responde com analise profunda. Use quando o humano pedir algo que requer expertise especifica: auditoria SEO, analise de ads, planejamento editorial, etc.',
        parameters: z.object({
          specialist: z.enum(['seo-strategist', 'ads-strategist', 'social-strategist']).describe('Qual especialista consultar'),
          question: z.string().describe('A pergunta ou tarefa a delegar (em portugues, seja especifico)'),
        }),
        execute: async (params: unknown) => {
          const { specialist, question } = params as { specialist: string; question: string }

          const agents: Record<string, { handleChat: (msg: string, ctx: RunContext, history: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<{ response: string; tokensUsed: number }> }> = {
            'seo-strategist': seoAgent,
            'ads-strategist': adsAgent,
            'social-strategist': socialAgent,
          }

          const specialistAgent = agents[specialist]
          if (!specialistAgent) return { error: `Especialista '${specialist}' nao encontrado` }

          try {
            let enrichedQuestion = question

            // SEO: fetch real data PROGRAMMATICALLY before delegating
            if (specialist === 'seo-strategist') {
              const domain = question.match(/[\w.-]+\.\w{2,}/)?.[0]
              const dataBlocks: string[] = []

              if (domain) {
                // Fetch Search Console data
                try {
                  const { querySearchConsole } = await import('@/lib/analytics/google-analytics')
                  const endDate = new Date().toISOString().split('T')[0]
                  const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
                  const scData = await querySearchConsole({
                    siteUrl: `sc-domain:${domain}`,
                    startDate,
                    endDate,
                    dimensions: ['query'],
                    rowLimit: 15,
                  })
                  let totalClicks = 0, totalImpressions = 0
                  for (const r of scData.rows) { totalClicks += r.clicks; totalImpressions += r.impressions }
                  const rows = scData.rows.map(r => `  ${r.keys[0]} — clicks=${r.clicks}, impr=${r.impressions}, ctr=${r.ctr}%, pos=${r.position}`).join('\n')
                  dataBlocks.push(`## DADOS REAIS DO SEARCH CONSOLE (${scData.period})\nTotal: ${totalClicks} cliques, ${totalImpressions} impressoes\nTop queries:\n${rows}`)
                } catch (e) {
                  dataBlocks.push(`## SEARCH CONSOLE: ⚠️ Erro ao obter dados — ${e instanceof Error ? e.message : String(e)}`)
                }

                // Fetch GA4 data — sessions only (no bounce rate: not a SEO signal without channel segmentation)
                try {
                  const { runGA4Report } = await import('@/lib/analytics/google-analytics')
                  const ga4 = await runGA4Report({
                    dimensions: ['pagePath'],
                    metrics: ['sessions', 'screenPageViews'],
                    dateRange: { startDate: '28daysAgo', endDate: 'today' },
                    limit: 8,
                    orderBy: { metric: 'sessions', desc: true },
                  })
                  const topPages = ga4.rows
                    .map(r => `  ${r.dimensions.pagePath} — sessoes=${r.metrics.sessions}, views=${r.metrics.screenPageViews}`)
                    .join('\n')
                  dataBlocks.push(`## TOP PAGINAS (GA4, 28 dias — todos os canais, use apenas como contexto)\n${topPages || 'Sem dados de paginas'}\n⚠️ Dados não segmentados por canal — use analyze_ga4_organic para análise SEO correta.`)
                } catch (e) {
                  dataBlocks.push(`## GOOGLE ANALYTICS: ⚠️ Erro ao obter dados — ${e instanceof Error ? e.message : String(e)}`)
                }
              }

              enrichedQuestion = dataBlocks.length > 0
                ? `${question}\n\n--- CONTEXTO PRELIMINAR (dados parciais, use run_full_audit para auditoria completa) ---\n${dataBlocks.join('\n\n')}\n\nExecute run_full_audit para o site ${domain ?? ''} — ele coleta dados reais completos e segmentados.`
                : question
            }

            const result = await specialistAgent.handleChat(enrichedQuestion, ctx, [])
            return {
              specialist,
              response: result.response,
              tokensUsed: result.tokensUsed,
            }
          } catch (err) {
            return {
              specialist,
              error: err instanceof Error ? err.message : String(err),
            }
          }
        },
      },
    ]
  }

  async evaluate(result: AgentResult, ctx: RunContext): Promise<EvalEntry> {
    return {
      agentSlug: 'editor-in-chief',
      inputSummary: 'Pipeline health check',
      outputSummary: JSON.stringify(result.details),
      autoScore: result.success ? 8 : 3,
      dimensions: {
        availability: result.success ? 10 : 0,
        responsiveness: result.durationMs < 5000 ? 10 : 5,
      },
      issues: result.errors,
      verdict: result.success ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as {
      telegramBriefing?: string
      recentErrors: number
      pendingContent: number
      publishedToday: number
      newTopics: number
      staleAgents: string[]
      lowScoreEvals: Array<{ agent_slug: string; auto_score: number; issues: string[] }>
      actionsToken: string[]
      suppressAlert?: boolean
    }

    // Only alert when there are real problems — no routine briefings
    const hasAlerts =
      (d.recentErrors ?? 0) > 3 ||
      (d.staleAgents?.length ?? 0) > 0 ||
      (d.lowScoreEvals?.length ?? 0) > 0

    if (!hasAlerts) return '' // Nothing critical — stay silent
    if (d.suppressAlert) return '' // Same alert already sent within cooldown window (4h dedup)

    const lines = ['⚠️ *Editor-Chefe — Alerta Operacional*', '']

    if ((d.recentErrors ?? 0) > 3) {
      lines.push(`🔴 Erros na última hora: ${d.recentErrors}`)
    }

    if (d.staleAgents?.length > 0) {
      lines.push(`🟡 Agentes travados: ${d.staleAgents.join(', ')}`)
    }

    if (d.lowScoreEvals?.length > 0) {
      lines.push('🔻 Entregas abaixo do padrão (score < 5):')
      for (const e of d.lowScoreEvals.slice(0, 3)) {
        const issues = e.issues?.slice(0, 2).join(', ') || 'sem detalhes'
        lines.push(`  - ${e.agent_slug}: score ${e.auto_score} (${issues})`)
      }
    }

    return lines.join('\n')
  }
}

export const agent = new EditorInChiefAgent()
