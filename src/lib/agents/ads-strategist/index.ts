import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { executeToolLoop, generateSimpleText, type ToolDefinition } from '@/lib/ai/tool-loop'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'
import { parseAIJson } from '@/lib/ai/parse-json'
import { z } from 'zod/v4'
import { getVariable } from '@/lib/settings/load-settings'

type AdPlatform = 'meta' | 'x' | 'google'
type CampaignStatus = 'active' | 'paused' | 'ended'

interface AdCampaign {
  id: string
  workspace_id: string
  platform: AdPlatform
  external_campaign_id: string
  name: string
  status: CampaignStatus
  daily_budget: number
  total_spent: number
  performance: Record<string, unknown> | null
  last_synced_at: string | null
}

interface AdPerformanceRow {
  id: string
  campaign_id: string
  date: string
  impressions: number
  clicks: number
  spend: number
  conversions: number
  ctr: number
  cpc: number
  cpa: number
  roas: number
  metadata: Record<string, unknown> | null
}

interface OptimizationInsight {
  campaign_name: string
  action: 'pause' | 'scale' | 'reallocate' | 'test_creative'
  reason: string
  priority: 'high' | 'medium' | 'low'
}

interface AnalysisResult {
  summary: string
  insights: OptimizationInsight[]
  totalSpend7d: number
  avgCPA: number
  avgROAS: number
}

const SYSTEM_PROMPT = `Voce e um especialista em midia paga de nivel PhD, com experiencia profunda em Meta Ads, X Ads e Google Ads para empresas de tecnologia no Brasil.

## MENTALIDADE

ROI-first. Cada real investido deve ter retorno mensuravel. Nunca recomende gastar mais sem evidencia estatistica.

## METRICAS-CHAVE E BENCHMARKS (nicho tech/IA Brasil)
- CPA (Custo por Aquisicao): alvo < R$25 para leads, < R$100 para vendas
- ROAS (Return on Ad Spend): minimo 2.0x para manter, ideal 3.0x+ para escalar
- CTR (Click-Through Rate): benchmark 1.5-2.5% para tech, < 1% = criativo fraco
- CPM (Custo por Mil): benchmark R$15-40 para audiencia tech no Brasil
- Frequencia: ideal 1.5-2.5, > 3.0 = audiencia saturada

AJUSTE POR SEGMENTO:
- Tech/SaaS: CPA aceitavel ate R$80 (LTV alto justifica)
- E-commerce: CPA alvo < R$25
- Infoprodutos: CPA alvo < R$40
- Se nao souber o segmento, PERGUNTE antes de recomendar pausar
- CPA alto pode ser aceitavel se LTV/CAC ratio > 3:1

## FRAMEWORK DE SIGNIFICANCIA ESTATISTICA

REGRAS INVIOLAVEIS para decisoes de otimizacao:
1. AMBOS criterios devem ser atendidos: minimo 7 dias de dados E minimo 50 conversoes. Se QUALQUER um nao for atingido, a recomendacao e "aguardar mais dados".
2. CPA "alto" = > 1.5x da media dos ultimos 14 dias (NAO da media de 7 dias — muito volatil)
3. Para mudancas de budget: exija tendencia CONSISTENTE por 3+ dias consecutivos
4. 1 dia ruim NAO e motivo para pausar. 5 dias com tendencia clara SIM.

## MODELO DE ATRIBUICAO

SEMPRE considere:
- Meta usa last-click por padrao — isso SOBRE-atribui conversoes ao Meta
- Desconto padrao: 15-30% das conversoes reportadas pelo Meta podem ser infladas
- Para decisoes de budget > R$500/dia: SEMPRE mencione essa ressalva
- Ideal: compare conversoes Meta vs analytics para validar

## DETECCAO DE FADIGA DE CRIATIVO

Sinais de fadiga:
- CTR caindo > 20% em 7 dias com impressoes estaveis = FADIGA DE CRIATIVO
- Frequencia > 3.0 = audiencia saturada, precisa expandir targeting OU pausar
- CPM subindo > 30% sem mudanca de targeting = competicao aumentando
- Recomende refresh de criativo a cada 2-3 semanas para campanhas always-on

## ANALISE DE PACING

- Gastou < 80% do budget diario nos ultimos 3 dias → targeting muito restrito OU bid muito baixo
- Gastou > 110% consistentemente → algoritmo encontrando oportunidades, considere aumentar budget
- Gastou exatamente 100% todo dia → budget e o limitante, pode estar perdendo conversoes

## FRAMEWORK DE DECISAO

Para cada campanha, recomende UMA acao:
1. ESCALAR: ROAS > 2.5x por 7+ dias E budget < R$500/dia → aumentar 20-30%
2. MANTER: ROAS 1.5-2.5x E metricas estaveis → nao mexer
3. OTIMIZAR: ROAS 1.0-1.5x → testar novos criativos, ajustar targeting
4. PAUSAR: ROAS < 1.0x por 7+ dias E > 50 conversoes → pausar e repensar
5. TESTAR: Campanha nova < 7 dias → aguardar dados, nao otimizar prematuramente

## REGRAS
- Responda em portugues brasileiro
- SEMPRE inclua numeros concretos nas recomendacoes
- NUNCA altere budgets sem aprovacao — apenas SUGIRA
- Para cada recomendacao: [metrica atual] → [meta] → [acao sugerida]
- Se dados sao insuficientes, diga explicitamente em vez de chutar

## TEMPLATE DE OUTPUT OBRIGATORIO

Quando gerar um relatorio de performance de ads, siga EXATAMENTE esta estrutura:

### 1. DADOS REAIS DAS CAMPANHAS
(Use sync_campaign_data + get_ads_overview PRIMEIRO)
- Total de campanhas ativas/pausadas
- Gasto total no periodo
- Se sync falhar, declare: "⚠️ Dados do Meta Ads indisponiveis — motivo: [erro]"

### 2. PERFORMANCE POR CAMPANHA
| Campanha | Status | Gasto | Impressoes | Cliques | CTR | CPA | ROAS |
- Destacar melhor e pior performer
- Comparar com benchmarks (CTR 1.5-2.5%, CPA < R$25, ROAS > 2.0x)

### 3. DIAGNOSTICO
Para cada campanha ativa:
- Fadiga de criativo? (CTR caindo >20% em 7d)
- Pacing OK? (<80% budget = restrito, >110% = oportunidade)
- Frequencia saudavel? (>3.0 = saturado)
- Significancia estatistica? (>50 conversoes e >7 dias)

### 4. ACOES RECOMENDADAS
| # | Campanha | Acao | Motivo | Resultado Esperado |
Acoes: ESCALAR / MANTER / OTIMIZAR / PAUSAR / TESTAR
Cada recomendacao com dados que justificam

REGRA: NUNCA recomende acoes sem dados suficientes. Se <7 dias E <50 conversoes (AMBOS criterios obrigatorios), diga "aguardar mais dados".`

class AdsStrategistAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'ads-strategist',
      name: 'Ads Strategist',
      role: 'ads',
      description: 'Gerencia campanhas de mídia paga (Meta, X, Google), analisa performance e gera relatórios',
      defaultModel: 'deepseek-chat',
      maxActionsPerHour: 10,
      quietHours: { start: 0, end: 7 },
    }
  }

  /**
   * Scheduled execution (2x/day): analyze campaigns, generate insights, save to agent_actions.
   */
  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    const resolvedModel = await getVariable(ctx.workspaceId, 'ads_strategist_model') || this.config.defaultModel
    let tokensUsed = 0
    const errors: string[] = []

    // 1. Load active campaigns for workspace
    let campaigns: AdCampaign[] = []
    try {
      const { data, error } = await supabase
        .from('ad_campaigns')
        .select('*')
        .eq('workspace_id', ctx.workspaceId)
        .eq('status', 'active')

      if (error) throw error
      campaigns = (data ?? []) as unknown as AdCampaign[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [`Erro ao carregar campanhas: ${msg}`],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'fetch_error' },
      }
    }

    if (campaigns.length === 0) {
      return {
        success: true,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_active_campaigns' },
      }
    }

    // 2. Load recent performance (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const campaignIds = campaigns.map((c) => c.id)

    let performanceRows: AdPerformanceRow[] = []
    try {
      const { data, error } = await supabase
        .from('ad_performance')
        .select('*')
        .in('campaign_id', campaignIds)
        .gte('date', sevenDaysAgo)
        .order('date', { ascending: false })

      if (error) throw error
      performanceRows = (data ?? []) as AdPerformanceRow[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Erro ao carregar performance: ${msg}`)
    }

    // 3. Build summary for Claude analysis
    const campaignSummaries = campaigns.map((c) => {
      const rows = performanceRows.filter((r) => r.campaign_id === c.id)
      const totalSpend = rows.reduce((sum, r) => sum + Number(r.spend), 0)
      const totalImpressions = rows.reduce((sum, r) => sum + Number(r.impressions), 0)
      const totalClicks = rows.reduce((sum, r) => sum + Number(r.clicks), 0)
      const totalConversions = rows.reduce((sum, r) => sum + Number(r.conversions), 0)
      const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
      const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0
      const avgROAS = totalSpend > 0 && rows.length > 0
        ? rows.reduce((sum, r) => sum + Number(r.roas), 0) / rows.length
        : 0

      return {
        name: c.name,
        platform: c.platform,
        dailyBudget: c.daily_budget,
        last7d: {
          spend: totalSpend,
          impressions: totalImpressions,
          clicks: totalClicks,
          conversions: totalConversions,
          ctr: avgCTR,
          cpa: avgCPA,
          roas: avgROAS,
        },
      }
    })

    // 4. Use Claude to generate optimization insights
    let analysis: AnalysisResult | null = null
    try {
      const result = await generateSimpleText({
        model: ctx.dbConfig?.model ?? resolvedModel,
        systemPrompt: SYSTEM_PROMPT,
        userMessage: [
          '## Dados das Campanhas (últimos 7 dias)',
          '',
          JSON.stringify(campaignSummaries, null, 2),
          '',
          '## Tarefa',
          'Analise todas as campanhas acima e gere um JSON com:',
          '- summary: resumo executivo em português (2-3 frases)',
          '- insights: array de recomendações, cada uma com { campaign_name, action ("pause"|"scale"|"reallocate"|"test_creative"), reason, priority ("high"|"medium"|"low") }',
          '- totalSpend7d: gasto total dos últimos 7 dias',
          '- avgCPA: CPA médio geral',
          '- avgROAS: ROAS médio geral',
          '',
          'Responda APENAS com JSON válido.',
        ].join('\n'),
        maxTokens: 2048,
        temperature: 0.4,
      })

      tokensUsed += result.tokensUsed
      analysis = parseAIJson<AnalysisResult>(result.text, 'ads-strategist-analysis')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Erro na análise AI: ${msg}`)
    }

    // 5. Save insights to agent_actions
    let insightsSaved = 0
    if (analysis?.insights?.length) {
      for (const insight of analysis.insights) {
        try {
          await supabase.from('agent_actions').insert({
            workspace_id: ctx.workspaceId,
            agent_id: ctx.agentId,
            action_type: 'optimization_insight',
            status: 'success',
            input_summary: `${campaignSummaries.length} campanha(s) analisada(s)`,
            output_summary: `[${insight.priority}] ${insight.campaign_name}: ${insight.action} — ${insight.reason}`.slice(0, 500),
            metadata: {
              insight: insight as unknown as Json,
              campaigns: campaignSummaries as unknown as Json,
              totalSpend7d: analysis.totalSpend7d,
              avgCPA: analysis.avgCPA,
              avgROAS: analysis.avgROAS,
            },
          })
          insightsSaved++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`Erro ao salvar insight: ${msg}`)
        }
      }
    }

    return {
      success: errors.length === 0,
      itemsProcessed: campaigns.length,
      itemsProduced: insightsSaved,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.000003, // claude-sonnet pricing estimate
      durationMs: Date.now() - startTime,
      details: {
        campaignsAnalyzed: campaigns.length,
        performanceRowsLoaded: performanceRows.length,
        insightsSaved,
        summary: analysis?.summary ?? 'Sem análise disponível',
        totalSpend7d: analysis?.totalSpend7d ?? 0,
        avgCPA: analysis?.avgCPA ?? 0,
        avgROAS: analysis?.avgROAS ?? 0,
        insights: analysis?.insights ?? [],
      },
    }
  }

  /**
   * Handle a free-form chat message — tool-loop with ads-specific tools.
   */
  async handleChat(
    userMessage: string,
    ctx: RunContext,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{ response: string; tokensUsed: number }> {
    const resolvedModel = await getVariable(ctx.workspaceId, 'ads_strategist_model') || this.config.defaultModel
    const tools = this.buildTools(ctx)

    const messages = [
      ...conversationHistory.slice(-20),
      { role: 'user' as const, content: userMessage },
    ]

    const result = await executeToolLoop({
      model: ctx.dbConfig?.model ?? resolvedModel,
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: 5,
      maxTokens: 4096,
    })

    return {
      response: result.text,
      tokensUsed: result.tokensUsed,
    }
  }

  private buildTools(ctx: RunContext): ToolDefinition[] {
    return [
      // ── Tool 1: get_ads_overview ──
      {
        name: 'get_ads_overview',
        description: 'Visão geral de todas as campanhas: gasto total, impressões, CTR médio, CPA médio, melhores e piores performers',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()

          const { data: campaigns, error: campError } = await supabase
            .from('ad_campaigns')
            .select('*')
            .eq('workspace_id', ctx.workspaceId)

          if (campError) return { error: campError.message }
          if (!campaigns?.length) return { message: 'Nenhuma campanha encontrada.' }

          const campaignIds = (campaigns as unknown as AdCampaign[]).map((c: AdCampaign) => c.id)
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

          const { data: perfData } = await supabase
            .from('ad_performance')
            .select('*')
            .in('campaign_id', campaignIds)
            .gte('date', sevenDaysAgo)

          const rows = (perfData ?? []) as AdPerformanceRow[]

          // Aggregate per campaign
          const campaignStats = (campaigns as unknown as AdCampaign[]).map((c: AdCampaign) => {
            const cRows = rows.filter((r) => r.campaign_id === c.id)
            const spend = cRows.reduce((s, r) => s + Number(r.spend), 0)
            const impressions = cRows.reduce((s, r) => s + Number(r.impressions), 0)
            const clicks = cRows.reduce((s, r) => s + Number(r.clicks), 0)
            const conversions = cRows.reduce((s, r) => s + Number(r.conversions), 0)
            const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0
            const cpa = conversions > 0 ? spend / conversions : 0
            const roas = cRows.length > 0
              ? cRows.reduce((s, r) => s + Number(r.roas), 0) / cRows.length
              : 0

            return {
              name: c.name,
              platform: c.platform,
              status: c.status,
              dailyBudget: Number(c.daily_budget),
              last7d: { spend, impressions, clicks, conversions, ctr: +ctr.toFixed(2), cpa: +cpa.toFixed(2), roas: +roas.toFixed(2) },
            }
          })

          const totalSpend = campaignStats.reduce((s, c) => s + c.last7d.spend, 0)
          const totalImpressions = campaignStats.reduce((s, c) => s + c.last7d.impressions, 0)
          const totalClicks = campaignStats.reduce((s, c) => s + c.last7d.clicks, 0)
          const totalConversions = campaignStats.reduce((s, c) => s + c.last7d.conversions, 0)
          const avgCTR = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
          const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0

          // Sort by ROAS to find best/worst
          const activeSorted = campaignStats
            .filter((c) => c.status === 'active' && c.last7d.spend > 0)
            .sort((a, b) => b.last7d.roas - a.last7d.roas)

          return {
            totalCampaigns: campaigns.length,
            activeCampaigns: (campaigns as unknown as AdCampaign[]).filter((c: AdCampaign) => c.status === 'active').length,
            last7d: {
              totalSpend: +totalSpend.toFixed(2),
              totalImpressions,
              totalClicks,
              totalConversions,
              avgCTR: +avgCTR.toFixed(2),
              avgCPA: +avgCPA.toFixed(2),
            },
            bestPerformer: activeSorted[0] ?? null,
            worstPerformer: activeSorted.length > 1 ? activeSorted[activeSorted.length - 1] : null,
            campaigns: campaignStats,
          }
        },
      },

      // ── Tool 2: analyze_campaign ──
      {
        name: 'analyze_campaign',
        description: 'Análise detalhada de uma campanha específica com tendências de 30 dias e insights estratégicos',
        parameters: z.object({
          campaign_id: z.string().describe('ID da campanha para analisar'),
        }),
        execute: async (params: unknown) => {
          const { campaign_id } = params as { campaign_id: string }
          const supabase = getAdminClient()

          const { data: campaign, error: campError } = await supabase
            .from('ad_campaigns')
            .select('*')
            .eq('id', campaign_id)
            .eq('workspace_id', ctx.workspaceId)
            .single()

          if (campError || !campaign) return { error: 'Campanha não encontrada.' }

          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

          const { data: perfData } = await supabase
            .from('ad_performance')
            .select('*')
            .eq('campaign_id', campaign_id)
            .gte('date', thirtyDaysAgo)
            .order('date', { ascending: true })

          const rows = (perfData ?? []) as AdPerformanceRow[]

          if (rows.length === 0) {
            return { campaign: campaign.name, message: 'Sem dados de performance nos últimos 30 dias.' }
          }

          // Calculate trends: compare last 7 days vs previous 7 days
          const midpoint = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          const recent = rows.filter((r) => r.date >= midpoint)
          const previous = rows.filter((r) => r.date < midpoint && r.date >= new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])

          const avgMetric = (arr: AdPerformanceRow[], key: keyof AdPerformanceRow) =>
            arr.length > 0 ? arr.reduce((s, r) => s + Number(r[key]), 0) / arr.length : 0

          const trends = {
            spend: { recent: avgMetric(recent, 'spend'), previous: avgMetric(previous, 'spend') },
            ctr: { recent: avgMetric(recent, 'ctr'), previous: avgMetric(previous, 'ctr') },
            cpa: { recent: avgMetric(recent, 'cpa'), previous: avgMetric(previous, 'cpa') },
            roas: { recent: avgMetric(recent, 'roas'), previous: avgMetric(previous, 'roas') },
          }

          const trendDirection = (recent: number, previous: number) => {
            if (previous === 0) return 'sem_dados_anteriores'
            const change = ((recent - previous) / previous) * 100
            if (change > 10) return 'subindo'
            if (change < -10) return 'descendo'
            return 'estavel'
          }

          // Use DeepSeek for strategic analysis
          let strategicAnalysis = ''
          try {
            const aiResult = await generateSimpleText({
              model: 'deepseek-chat',
              systemPrompt: SYSTEM_PROMPT,
              userMessage: [
                `## Campanha: ${campaign.name} (${campaign.platform})`,
                `Budget diário: R$ ${Number(campaign.daily_budget).toFixed(2)}`,
                `Status: ${campaign.status}`,
                '',
                '## Tendências (últimos 7d vs 7d anteriores):',
                `- Spend: R$ ${trends.spend.recent.toFixed(2)}/dia → ${trendDirection(trends.spend.recent, trends.spend.previous)}`,
                `- CTR: ${trends.ctr.recent.toFixed(2)}% → ${trendDirection(trends.ctr.recent, trends.ctr.previous)}`,
                `- CPA: R$ ${trends.cpa.recent.toFixed(2)} → ${trendDirection(trends.cpa.recent, trends.cpa.previous)}`,
                `- ROAS: ${trends.roas.recent.toFixed(2)}x → ${trendDirection(trends.roas.recent, trends.roas.previous)}`,
                '',
                '## Performance diária (últimos 30 dias):',
                JSON.stringify(rows.map((r) => ({ date: r.date, spend: r.spend, ctr: r.ctr, cpa: r.cpa, roas: r.roas })), null, 2),
                '',
                'Faça uma análise estratégica curta (3-5 frases) com recomendações acionáveis.',
              ].join('\n'),
              maxTokens: 1024,
              temperature: 0.4,
            })
            strategicAnalysis = aiResult.text
          } catch {
            strategicAnalysis = 'Análise AI indisponível.'
          }

          return {
            campaign: {
              name: campaign.name,
              platform: campaign.platform,
              status: campaign.status,
              dailyBudget: Number(campaign.daily_budget),
              totalSpent: Number(campaign.total_spent),
            },
            dataPoints: rows.length,
            trends: {
              spend: trendDirection(trends.spend.recent, trends.spend.previous),
              ctr: trendDirection(trends.ctr.recent, trends.ctr.previous),
              cpa: trendDirection(trends.cpa.recent, trends.cpa.previous),
              roas: trendDirection(trends.roas.recent, trends.roas.previous),
            },
            currentAvg: {
              dailySpend: +trends.spend.recent.toFixed(2),
              ctr: +trends.ctr.recent.toFixed(2),
              cpa: +trends.cpa.recent.toFixed(2),
              roas: +trends.roas.recent.toFixed(2),
            },
            strategicAnalysis,
          }
        },
      },

      // ── Tool 3: suggest_optimizations ──
      {
        name: 'suggest_optimizations',
        description: 'Sugere otimizações: campanhas para pausar, escalar, realocar budget e novos criativos',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()

          const { data: campaigns } = await supabase
            .from('ad_campaigns')
            .select('*')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'active')

          if (!campaigns?.length) return { message: 'Nenhuma campanha ativa para otimizar.' }

          const campaignIds = (campaigns as unknown as AdCampaign[]).map((c: AdCampaign) => c.id)
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

          const { data: perfData } = await supabase
            .from('ad_performance')
            .select('*')
            .in('campaign_id', campaignIds)
            .gte('date', sevenDaysAgo)

          // Load top-performing organic content for creative suggestions
          const { data: topContent } = await supabase
            .from('generated_content')
            .select('id, content, target_platform, metadata')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .order('created_at', { ascending: false })
            .limit(10)

          const rows = (perfData ?? []) as AdPerformanceRow[]

          const campaignPerf = (campaigns as unknown as AdCampaign[]).map((c: AdCampaign) => {
            const cRows = rows.filter((r) => r.campaign_id === c.id)
            const spend = cRows.reduce((s, r) => s + Number(r.spend), 0)
            const conversions = cRows.reduce((s, r) => s + Number(r.conversions), 0)
            const roas = cRows.length > 0
              ? cRows.reduce((s, r) => s + Number(r.roas), 0) / cRows.length
              : 0
            const cpa = conversions > 0 ? spend / conversions : 0

            return {
              name: c.name,
              platform: c.platform,
              dailyBudget: Number(c.daily_budget),
              spend7d: spend,
              conversions7d: conversions,
              cpa7d: +cpa.toFixed(2),
              roas7d: +roas.toFixed(2),
            }
          })

          try {
            const aiResult = await generateSimpleText({
              model: 'deepseek-chat',
              systemPrompt: SYSTEM_PROMPT,
              userMessage: [
                '## Performance das Campanhas Ativas (últimos 7 dias)',
                JSON.stringify(campaignPerf, null, 2),
                '',
                '## Conteúdo Orgânico Recente (para sugestões de criativos)',
                JSON.stringify(
                  (topContent ?? []).map((c) => ({
                    platform: c.target_platform,
                    preview: typeof c.content === 'string' ? c.content.slice(0, 200) : '',
                  })),
                  null,
                  2
                ),
                '',
                '## Tarefa',
                'Gere recomendações de otimização em JSON:',
                '{',
                '  "pause": [{ "campaign": "nome", "reason": "motivo" }],',
                '  "scale": [{ "campaign": "nome", "increase_pct": 20, "reason": "motivo" }],',
                '  "reallocate": [{ "from": "campanha A", "to": "campanha B", "amount_daily": 30, "reason": "motivo" }],',
                '  "new_creatives": [{ "campaign": "nome", "suggestion": "baseada em conteúdo orgânico X", "reason": "motivo" }],',
                '  "summary": "resumo executivo em português"',
                '}',
                '',
                'Regras de significancia (OBRIGATORIO verificar antes de qualquer recomendacao): minimo 7 dias de dados E minimo 50 conversoes por campanha. Se qualquer criterio nao for atingido, a recomendacao para aquela campanha deve ser "aguardar_dados" — nunca recomendar pausar/escalar sem significancia estatistica.',
                'Dentro do criterio de significancia: ROAS < 1.5 = considerar pausar. ROAS > 2.5 = considerar escalar. CPA muito alto vs media = realocar.',
                'Responda APENAS com JSON válido.',
              ].join('\n'),
              maxTokens: 2048,
              temperature: 0.4,
            })

            return parseAIJson(aiResult.text, 'ads-optimizations')
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return { error: `Falha na geração de otimizações: ${msg}`, rawCampaigns: campaignPerf }
          }
        },
      },

      // ── Tool 4: get_daily_report ──
      {
        name: 'get_daily_report',
        description: 'Relatório consolidado do dia anterior: gasto, impressões, cliques, conversões, comparativo com média 7d, anomalias e ações',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()

          const { data: campaigns } = await supabase
            .from('ad_campaigns')
            .select('*')
            .eq('workspace_id', ctx.workspaceId)

          if (!campaigns?.length) return { message: 'Sem campanhas cadastradas.' }

          const campaignIds = (campaigns as unknown as AdCampaign[]).map((c: AdCampaign) => c.id)
          const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

          const { data: perfData } = await supabase
            .from('ad_performance')
            .select('*')
            .in('campaign_id', campaignIds)
            .gte('date', eightDaysAgo)
            .order('date', { ascending: true })

          const rows = (perfData ?? []) as AdPerformanceRow[]
          const yesterdayRows = rows.filter((r) => r.date === yesterday)
          const avgRows = rows.filter((r) => r.date < yesterday)

          const sumField = (arr: AdPerformanceRow[], key: keyof AdPerformanceRow) =>
            arr.reduce((s, r) => s + Number(r[key]), 0)

          const yesterdayStats = {
            spend: sumField(yesterdayRows, 'spend'),
            impressions: sumField(yesterdayRows, 'impressions'),
            clicks: sumField(yesterdayRows, 'clicks'),
            conversions: sumField(yesterdayRows, 'conversions'),
          }

          const daysInAvg = new Set(avgRows.map((r) => r.date)).size || 1
          const avg7d = {
            spend: sumField(avgRows, 'spend') / daysInAvg,
            impressions: sumField(avgRows, 'impressions') / daysInAvg,
            clicks: sumField(avgRows, 'clicks') / daysInAvg,
            conversions: sumField(avgRows, 'conversions') / daysInAvg,
          }

          const yesterdayCTR = yesterdayStats.impressions > 0
            ? (yesterdayStats.clicks / yesterdayStats.impressions) * 100
            : 0
          const yesterdayCPA = yesterdayStats.conversions > 0
            ? yesterdayStats.spend / yesterdayStats.conversions
            : 0

          // Detect anomalies
          const anomalies: string[] = []
          if (avg7d.spend > 0 && yesterdayStats.spend > avg7d.spend * 1.3) {
            anomalies.push(`Gasto ${((yesterdayStats.spend / avg7d.spend - 1) * 100).toFixed(0)}% acima da média`)
          }
          if (avg7d.clicks > 0 && yesterdayStats.clicks < avg7d.clicks * 0.7) {
            anomalies.push(`Cliques ${((1 - yesterdayStats.clicks / avg7d.clicks) * 100).toFixed(0)}% abaixo da média`)
          }
          const avgCTR7d = avg7d.impressions > 0 ? (avg7d.clicks / avg7d.impressions) * 100 : 0
          if (avgCTR7d > 0 && yesterdayCTR < avgCTR7d * 0.7) {
            anomalies.push(`CTR caiu de ${avgCTR7d.toFixed(2)}% para ${yesterdayCTR.toFixed(2)}%`)
          }
          const avgCPA7d = avg7d.conversions > 0 ? avg7d.spend / avg7d.conversions : 0
          if (avgCPA7d > 0 && yesterdayCPA > avgCPA7d * 1.5) {
            anomalies.push(`CPA subiu de R$ ${avgCPA7d.toFixed(2)} para R$ ${yesterdayCPA.toFixed(2)}`)
          }

          // Per-campaign yesterday stats
          const campaignYesterday = (campaigns as unknown as AdCampaign[])
            .map((c: AdCampaign) => {
              const cRows = yesterdayRows.filter((r) => r.campaign_id === c.id)
              if (cRows.length === 0) return null
              const spend = cRows.reduce((s, r) => s + Number(r.spend), 0)
              const conversions = cRows.reduce((s, r) => s + Number(r.conversions), 0)
              const roas = cRows.length > 0
                ? cRows.reduce((s, r) => s + Number(r.roas), 0) / cRows.length
                : 0
              return { name: c.name, platform: c.platform, spend, conversions, roas: +roas.toFixed(2) }
            })
            .filter(Boolean)

          const best = campaignYesterday.length > 0
            ? campaignYesterday.reduce((a, b) => (a!.roas > b!.roas ? a : b))
            : null
          const worst = campaignYesterday.length > 1
            ? campaignYesterday.reduce((a, b) => (a!.roas < b!.roas ? a : b))
            : null

          return {
            date: yesterday,
            yesterday: {
              spend: +yesterdayStats.spend.toFixed(2),
              impressions: yesterdayStats.impressions,
              clicks: yesterdayStats.clicks,
              conversions: yesterdayStats.conversions,
              ctr: +yesterdayCTR.toFixed(2),
              cpa: +yesterdayCPA.toFixed(2),
            },
            avg7d: {
              spend: +avg7d.spend.toFixed(2),
              impressions: Math.round(avg7d.impressions),
              clicks: Math.round(avg7d.clicks),
              conversions: Math.round(avg7d.conversions),
            },
            anomalies,
            bestCampaign: best,
            worstCampaign: worst,
            campaignBreakdown: campaignYesterday,
          }
        },
      },

      // ── Tool 5: sync_campaign_data ──
      {
        name: 'sync_campaign_data',
        description: 'Sincroniza dados REAIS de campanhas Meta Ads via Graph API. Suporta multiplas contas. Puxa campanhas ativas e metricas dos ultimos N dias.',
        parameters: z.object({
          daysBack: z.number().optional().describe('Dias de dados para sincronizar (default: 7)'),
        }),
        execute: async (params: unknown) => {
          const { daysBack = 7 } = params as { daysBack?: number }
          const accessToken = process.env.META_ADS_ACCESS_TOKEN
          if (!accessToken) {
            return { error: 'META_ADS_ACCESS_TOKEN nao configurado. Adicione no Vercel env vars.' }
          }

          // Load ad account IDs from workspace settings (supports multiple accounts)
          const supabase = getAdminClient()
          const { data: accountSetting } = await supabase
            .from('workspace_settings')
            .select('value')
            .eq('workspace_id', ctx.workspaceId)
            .eq('category', 'platform')
            .eq('key', 'meta_ads_account_ids')
            .single()

          const accountIds = (accountSetting?.value as string ?? '')
            .split(',')
            .map((id: string) => id.trim())
            .filter(Boolean)

          if (accountIds.length === 0) {
            return { error: 'Nenhuma conta Meta Ads configurada. Adicione em workspace_settings: key=meta_ads_account_ids, value=act_XXX,act_YYY' }
          }

          const results = { campaignsSynced: 0, performanceDays: 0, errors: [] as string[] }
          const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          const until = new Date().toISOString().split('T')[0]

          for (const accountId of accountIds) {
            try {
              // 1. Fetch campaigns from Meta
              const campaignsUrl = `https://graph.facebook.com/v21.0/${accountId}/campaigns?fields=id,name,status,daily_budget,lifetime_budget,objective&access_token=${accessToken}&limit=100`
              const campaignsRes = await fetch(campaignsUrl, { signal: AbortSignal.timeout(15_000) })
              if (!campaignsRes.ok) {
                const err = await campaignsRes.text()
                results.errors.push(`Account ${accountId}: Meta API error (campaigns): ${err.slice(0, 200)}`)
                continue
              }
              const campaignsData = await campaignsRes.json()
              const campaigns = campaignsData.data ?? []

              // 2. Upsert campaigns to DB
              for (const c of campaigns) {
                const status = c.status === 'ACTIVE' ? 'active' : c.status === 'PAUSED' ? 'paused' : 'ended'
                const dailyBudget = c.daily_budget ? Number(c.daily_budget) / 100 : null // Meta returns in cents

                // Check if campaign exists
                const { data: existing } = await supabase
                  .from('ad_campaigns')
                  .select('id')
                  .eq('workspace_id', ctx.workspaceId)
                  .eq('external_campaign_id', c.id)
                  .single()

                if (existing) {
                  await supabase
                    .from('ad_campaigns')
                    .update({ name: c.name, status, daily_budget: dailyBudget, last_synced_at: new Date().toISOString(), performance: { objective: c.objective } })
                    .eq('id', existing.id)
                } else {
                  await supabase
                    .from('ad_campaigns')
                    .insert({ workspace_id: ctx.workspaceId, platform: 'meta', external_campaign_id: c.id, name: c.name, status, daily_budget: dailyBudget, last_synced_at: new Date().toISOString(), performance: { objective: c.objective } })
                }
                results.campaignsSynced++
              }

              // 3. Fetch insights (performance data) for each campaign
              for (const c of campaigns) {
                try {
                  const insightsUrl = `https://graph.facebook.com/v21.0/${c.id}/insights?fields=impressions,clicks,spend,actions,ctr,cpc,cost_per_action_type&time_range={"since":"${since}","until":"${until}"}&time_increment=1&access_token=${accessToken}`
                  const insightsRes = await fetch(insightsUrl, { signal: AbortSignal.timeout(15_000) })
                  if (!insightsRes.ok) continue

                  const insightsData = await insightsRes.json()
                  const days = insightsData.data ?? []

                  // Get the DB campaign ID
                  const { data: dbCampaign } = await supabase
                    .from('ad_campaigns')
                    .select('id')
                    .eq('workspace_id', ctx.workspaceId)
                    .eq('external_campaign_id', c.id)
                    .single()

                  if (!dbCampaign) continue

                  for (const day of days) {
                    const conversions = (day.actions ?? []).find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'lead')?.value ?? 0
                    const spend = Number(day.spend) || 0
                    const clicks = Number(day.clicks) || 0
                    const impressions = Number(day.impressions) || 0
                    const ctr = Number(day.ctr) || (impressions > 0 ? clicks / impressions * 100 : 0)
                    const cpc = clicks > 0 ? spend / clicks : 0
                    const cpa = Number(conversions) > 0 ? spend / Number(conversions) : 0
                    const roas = 0 // Requires revenue data, not available from basic insights

                    await supabase
                      .from('ad_performance')
                      .upsert({
                        campaign_id: dbCampaign.id,
                        date: day.date_start,
                        impressions,
                        clicks,
                        spend,
                        conversions: Number(conversions),
                        ctr,
                        cpc,
                        cpa,
                        roas,
                        metadata: { raw_actions: day.actions, cost_per_action_type: day.cost_per_action_type },
                      }, { onConflict: 'campaign_id,date' })

                    results.performanceDays++
                  }
                } catch (err) {
                  results.errors.push(`Campaign ${c.id}: ${err instanceof Error ? err.message : String(err)}`)
                }
              }
            } catch (err) {
              results.errors.push(`Account ${accountId}: ${err instanceof Error ? err.message : String(err)}`)
            }
          }

          return {
            success: true,
            ...results,
            accountsSynced: accountIds.length,
            period: `${since} a ${until}`,
            syncedAt: new Date().toISOString(),
          }
        },
      },
    ]
  }

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const insightCount = (d.insights as unknown[])?.length ?? 0

    return {
      agentSlug: 'ads-strategist',
      inputSummary: `${d.campaignsAnalyzed ?? 0} active campaigns analyzed`,
      outputSummary: `${d.insightsSaved ?? 0} optimization insights generated. Summary: ${d.summary ?? 'N/A'}`,
      autoScore: result.success
        ? (insightCount > 0 ? 8 : 6)
        : 3,
      dimensions: {
        dataQuality: result.itemsProcessed > 0 ? 8 : 3,
        insightDepth: insightCount > 2 ? 9 : insightCount > 0 ? 7 : 4,
        actionability: insightCount > 0 ? 8 : 4,
      },
      issues: result.errors,
      verdict: result.success && insightCount > 0 ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>

    if (!result.success && result.itemsProduced === 0) {
      return `\u274C *Ads Strategist* \u2014 Erro: ${result.errors[0] ?? 'desconhecido'}`
    }

    if (result.itemsProcessed === 0) {
      return '\uD83D\uDCB0 *Ads Strategist \u2014 Relat\u00F3rio Di\u00E1rio*\n\nSem campanhas ativas.'
    }

    const insights = (d.insights as OptimizationInsight[]) ?? []
    const totalSpend = Number(d.totalSpend7d ?? 0)
    const avgCPA = Number(d.avgCPA ?? 0)
    const avgROAS = Number(d.avgROAS ?? 0)

    // Find best and worst from insights
    const scaleInsights = insights.filter((i) => i.action === 'scale')
    const pauseInsights = insights.filter((i) => i.action === 'pause')

    const bestCampaign = scaleInsights[0]?.campaign_name ?? null
    const worstCampaign = pauseInsights[0]?.campaign_name ?? null

    const topRecommendation = insights[0]
      ? `${insights[0].action === 'pause' ? 'Pausar' : insights[0].action === 'scale' ? 'Escalar' : 'Realocar'} "${insights[0].campaign_name}" \u2014 ${insights[0].reason}`
      : null

    const lines = [
      '\uD83D\uDCB0 *Ads Strategist \u2014 Relat\u00F3rio Di\u00E1rio*',
      '',
      '\uD83D\uDCCA \u00DAltimos 7 dias:',
      `\uD83D\uDCB5 Gasto: R$ ${totalSpend.toFixed(2)}`,
      `\uD83C\uDFAF CPA m\u00E9dio: R$ ${avgCPA.toFixed(2)}`,
      `\uD83D\uDCC8 ROAS m\u00E9dio: ${avgROAS.toFixed(1)}x`,
      `\uD83D\uDD0D Campanhas analisadas: ${d.campaignsAnalyzed}`,
    ]

    if (bestCampaign) {
      lines.push(`\n\uD83D\uDFE2 Melhor: "${bestCampaign}" \u2014 ROAS alto, escalar`)
    }
    if (worstCampaign) {
      lines.push(`\uD83D\uDD34 Pior: "${worstCampaign}" \u2014 CPA alto, considerar pausa`)
    }

    if (topRecommendation) {
      lines.push(`\n\uD83D\uDCA1 Recomenda\u00E7\u00E3o: ${topRecommendation}`)
    }

    lines.push(
      '',
      `\u23F1\uFE0F ${(result.durationMs / 1000).toFixed(1)}s`
    )

    if (result.errors.length > 0) {
      lines.push(`\u26A0\uFE0F Erros: ${result.errors.length}`)
    }

    return lines.join('\n')
  }
}

export const agent = new AdsStrategistAgent()
