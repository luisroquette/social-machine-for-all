import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { executeToolLoop, generateSimpleText, type ToolDefinition } from '@/lib/ai/tool-loop'
import { getAdminClient } from '@/lib/supabase/admin'
import { parseAIJson } from '@/lib/ai/parse-json'
import { z } from 'zod/v4'
import { getVariable } from '@/lib/settings/load-settings'

const SYSTEM_PROMPT = `Voce e um estrategista de conteudo digital de nivel PhD, especializado em growth e engajamento para marcas tech/IA no Brasil.

Voce PLANEJA conteudo (define temas, formatos, datas, segmentos) mas NAO escreve o texto final dos posts.

REGRA PRINCIPAL: Decisoes SEMPRE baseadas em dados reais, nunca em intuicao. Se dados sao insuficientes (< 20 posts), declare explicitamente.

## FRAMEWORK: CONTENT PILLARS (HubSpot Methodology Adaptada)

Cada semana DEVE ter equilibrio entre 4 pilares:
1. EDUCACIONAL (40%): Tutoriais, explicacoes, how-tos, dados, benchmarks
   - Objetivo: Demonstrar expertise e gerar saves/shares
   - Exemplo: "Como implementar RAG com Supabase em 5 passos"
2. THOUGHT LEADERSHIP (25%): Analises, opinioes, previsoes, tendencias
   - Objetivo: Posicionar como autoridade no nicho
   - Exemplo: "Por que fine-tuning esta perdendo relevancia — dados de 6 meses"
3. CURATED/COMMENTARY (20%): Reacao a noticias, resenhas, benchmarks alheios
   - Objetivo: Manter relevancia e velocidade de resposta
   - Exemplo: "OpenAI lancou X — aqui esta o que ninguem percebeu"
4. ENGAGEMENT (15%): Perguntas, enquetes, provocacoes, debates
   - Objetivo: Gerar replies e algoritmo boost
   - Exemplo: "Claude vs GPT-4 para codigo: qual voce usa no dia-a-dia?"

REGRA: NUNCA planeje uma semana com > 60% de um unico pilar.

## SEGMENTOS DE AUDIENCIA

Cada post deve almejar UM segmento primario:
1. "devs_practitioners": Querem codigo, benchmarks, tutoriais praticos (predomina no Twitter/X)
2. "tech_leaders": Querem insights estrategicos, ROI, tendencias de mercado (predomina no LinkedIn)
3. "ai_curious": Querem entender impacto, explicacoes acessiveis (predomina no Instagram)

## FUNNEL MAPPING

Cada post no calendario deve ter um estagio:
- TOFU (Awareness): Alcance maximo, temas amplos, formato viral
- MOFU (Consideration): Demonstra expertise, comparacoes, case studies
- BOFU (Decision): CTA direto, prova social, resultados concretos

MIX IDEAL SEMANAL: 50% TOFU, 30% MOFU, 20% BOFU

## SAZONALIDADE E EVENTOS
Considere no planejamento:
- Lancamentos de modelos: GPT, Claude, Gemini (geralmente trimestral)
- Conferencias: NeurIPS (dez), ICML (jul), Google I/O (mai), WWDC (jun), AWS re:Invent (nov)
- Eventos comerciais: Black Friday (nov), volta as aulas (jan/fev)
- Ajuste o calendario editorial para aproveitar o momentum de eventos proximos
- Na semana de um grande lancamento (ex: novo GPT), aumente frequencia de posts em 50%

## ANALISE DE PERFORMANCE

Ao analisar dados, va ALEM dos numeros basicos:
- Week-over-week trend: melhorando ou declinando?
- Content type gap: se nao publicou tipo X em 2+ semanas, flag como gap
- Posting consistency: variacao > 30% entre semanas = inconsistente
- Format-performance correlation: quais formatos (pergunta, dado, tutorial) tem melhor score?
- Day-hour heatmap: cruze dia da semana + hora para encontrar sweet spots
- Engagement pattern: posts com pergunta vs statement — qual performa melhor?

## REGRAS
- Responda em portugues brasileiro
- Decisoes SEMPRE baseadas em dados, nunca em intuicao
- Cite numeros especificos ao recomendar mudancas
- Se os dados sao insuficientes (< 20 posts), diga explicitamente
- Cada recomendacao deve ter: o que mudar, por que mudar, resultado esperado`

interface CalendarEntry {
  planned_date: string
  theme: string
  content_type: string
  target_platform: string
  strategy_notes: string
}

interface PerformanceMetrics {
  totalPublished: number
  avgScore: number
  topPerformer: { content: string; score: number; platform: string } | null
  byDayOfWeek: Record<string, { count: number; avgScore: number }>
  byContentType: Record<string, { count: number; avgScore: number }>
  byHour: Record<string, { count: number; avgScore: number }>
}

class SocialStrategistAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'social-strategist',
      name: 'Social Media Strategist',
      role: 'strategy',
      description: 'Planeja calendário editorial, analisa performance e recomenda ajustes de estratégia',
      defaultModel: 'deepseek-chat',
      maxActionsPerHour: 10,
      quietHours: { start: 0, end: 6 },
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduled execution
  // ---------------------------------------------------------------------------

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    const resolvedModel = await getVariable(ctx.workspaceId, 'social_strategist_model') || this.config.defaultModel
    const errors: string[] = []
    let tokensUsed = 0

    // 1. Analyze last 7 days of published content performance
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: publishedContent } = await supabase
      .from('generated_content')
      .select('content, target_platform, status, published_at, review_score')
      .eq('workspace_id', ctx.workspaceId)
      .eq('status', 'published')
      .gte('published_at', sevenDaysAgo)
      .order('published_at', { ascending: false })

    const performance = this.computePerformanceMetrics(publishedContent ?? [])

    // 2. Analyze trending_topics patterns
    const { data: trendingTopics } = await supabase
      .from('trending_topics')
      .select('title, relevance, detected_at')
      .eq('workspace_id', ctx.workspaceId)
      .order('detected_at', { ascending: false })
      .limit(30)

    // 3. Generate editorial plan for next 7 days via Claude
    const today = new Date()
    const nextWeekDates = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today)
      d.setDate(d.getDate() + i + 1)
      return d.toISOString().split('T')[0]
    })

    const planPrompt = [
      'Analise os dados de performance e trending topics e crie um plano editorial para os próximos 7 dias.',
      '',
      `## Performance últimos 7 dias:`,
      `Posts publicados: ${performance.totalPublished}`,
      `Score médio: ${performance.avgScore.toFixed(1)}`,
      `Top performer: ${performance.topPerformer ? `"${performance.topPerformer.content.slice(0, 100)}..." (score: ${performance.topPerformer.score})` : 'N/A'}`,
      `Por dia da semana: ${JSON.stringify(performance.byDayOfWeek)}`,
      `Por tipo de conteúdo: ${JSON.stringify(performance.byContentType)}`,
      '',
      `## Trending Topics recentes:`,
      ...(trendingTopics ?? []).slice(0, 10).map((t) => `- ${t.title} (relevância: ${t.relevance})`),
      '',
      `## Datas disponíveis: ${nextWeekDates.join(', ')}`,
      '',
      'Retorne SOMENTE um JSON array com objetos contendo: planned_date, theme, content_type, target_platform, strategy_notes.',
      'Crie entre 5 e 10 entradas. Priorize formatos e horários que performam melhor baseado nos dados.',
    ].join('\n')

    let calendarEntries: CalendarEntry[] = []
    try {
      const planResult = await generateSimpleText({
        model: ctx.dbConfig?.model ?? resolvedModel,
        systemPrompt: SYSTEM_PROMPT,
        userMessage: planPrompt,
        maxTokens: 4096,
        temperature: 0.7,
      })
      tokensUsed += planResult.tokensUsed

      calendarEntries = parseAIJson<CalendarEntry[]>(planResult.text, 'editorial-plan')
    } catch (err) {
      errors.push(`Erro ao gerar plano editorial: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 4. Save to editorial_calendar
    let calendarSaved = 0
    if (calendarEntries.length > 0) {
      const rows = calendarEntries.map((entry) => ({
        workspace_id: ctx.workspaceId,
        planned_date: entry.planned_date,
        theme: entry.theme,
        content_type: entry.content_type,
        target_platform: entry.target_platform,
        strategy_notes: entry.strategy_notes,
        status: 'planned',
      }))

      const { error: calendarError, data: inserted } = await supabase
        .from('editorial_calendar')
        .insert(rows)
        .select('id')

      if (calendarError) {
        errors.push(`Erro ao salvar calendário: ${calendarError.message}`)
      } else {
        calendarSaved = inserted?.length ?? 0
      }
    }

    // 5. Save performance snapshot
    const periodStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const periodEnd = new Date().toISOString().split('T')[0]

    const insights = this.generateInsights(performance, publishedContent ?? [])

    const { error: snapshotError } = await supabase
      .from('performance_snapshots')
      .insert({
        workspace_id: ctx.workspaceId,
        period_start: periodStart,
        period_end: periodEnd,
        metrics: {
          totalPublished: performance.totalPublished,
          avgScore: performance.avgScore,
          topPerformer: performance.topPerformer
            ? { content: performance.topPerformer.content.slice(0, 200), score: performance.topPerformer.score }
            : null,
          byDayOfWeek: performance.byDayOfWeek,
          byContentType: performance.byContentType,
          byHour: performance.byHour,
        },
        insights: insights.insights,
        recommendations: insights.recommendations,
      })

    if (snapshotError) {
      errors.push(`Erro ao salvar snapshot: ${snapshotError.message}`)
    }

    return {
      success: errors.length === 0,
      itemsProcessed: performance.totalPublished,
      itemsProduced: calendarSaved,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.000003,
      durationMs: Date.now() - startTime,
      details: {
        performance: {
          totalPublished: performance.totalPublished,
          avgScore: Number(performance.avgScore.toFixed(1)),
          topPerformerScore: performance.topPerformer?.score ?? null,
        },
        calendarEntriesCreated: calendarSaved,
        trendingTopicsAnalyzed: trendingTopics?.length ?? 0,
        insights: insights.insights,
        recommendations: insights.recommendations,
        calendarPreview: calendarEntries.slice(0, 5).map((e) => ({
          date: e.planned_date,
          theme: e.theme,
          type: e.content_type,
          platform: e.target_platform,
        })),
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Chat interface (Telegram)
  // ---------------------------------------------------------------------------

  async handleChat(
    userMessage: string,
    ctx: RunContext,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{ response: string; tokensUsed: number }> {
    const resolvedModel = await getVariable(ctx.workspaceId, 'social_strategist_model') || this.config.defaultModel
    const tools = this.buildTools(ctx, ctx.dbConfig?.model ?? resolvedModel)

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

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  private buildTools(ctx: RunContext, modelOverride?: string): ToolDefinition[] {
    return [
      {
        name: 'create_editorial_plan',
        description: 'Gera plano editorial semanal baseado em performance e tendências',
        parameters: z.object({
          days: z.number().optional().describe('Número de dias para planejar (default: 7)'),
        }),
        execute: async (params: unknown) => {
          const { days = 7 } = params as { days?: number }
          const supabase = getAdminClient()

          // Fetch recent published content performance
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
          const { data: publishedContent } = await supabase
            .from('generated_content')
            .select('content, target_platform, status, published_at, review_score')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .gte('published_at', thirtyDaysAgo)
            .order('review_score', { ascending: false })
            .limit(50)

          // Fetch trending topics
          const { data: topics } = await supabase
            .from('trending_topics')
            .select('title, relevance, detected_at')
            .eq('workspace_id', ctx.workspaceId)
            .order('detected_at', { ascending: false })
            .limit(20)

          const performance = this.computePerformanceMetrics(publishedContent ?? [])

          const today = new Date()
          const dates = Array.from({ length: days }, (_, i) => {
            const d = new Date(today)
            d.setDate(d.getDate() + i + 1)
            return d.toISOString().split('T')[0]
          })

          const planResult = await generateSimpleText({
            model: modelOverride ?? this.config.defaultModel,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Crie um plano editorial para ${days} dias.`,
              '',
              `Dados de performance (últimos 30 dias): ${performance.totalPublished} posts, score médio ${performance.avgScore.toFixed(1)}`,
              `Melhores dias: ${JSON.stringify(performance.byDayOfWeek)}`,
              `Melhores tipos: ${JSON.stringify(performance.byContentType)}`,
              '',
              `Trending topics: ${(topics ?? []).map((t) => t.title).join(', ')}`,
              `Datas: ${dates.join(', ')}`,
              '',
              'Retorne JSON array com: planned_date, theme, content_type, target_platform, strategy_notes.',
            ].join('\n'),
            maxTokens: 4096,
          })

          const entries = parseAIJson<CalendarEntry[]>(planResult.text, 'editorial-plan')

          // Save to editorial_calendar
          const rows = entries.map((entry) => ({
            workspace_id: ctx.workspaceId,
            planned_date: entry.planned_date,
            theme: entry.theme,
            content_type: entry.content_type,
            target_platform: entry.target_platform,
            strategy_notes: entry.strategy_notes,
            status: 'planned',
          }))

          const { error, data: inserted } = await supabase
            .from('editorial_calendar')
            .insert(rows)
            .select('id')

          if (error) return { ok: false, error: error.message }

          return {
            ok: true,
            entriesCreated: inserted?.length ?? 0,
            plan: entries,
          }
        },
      },
      {
        name: 'analyze_performance',
        description: 'Analisa métricas de conteúdo publicado agrupando por dia da semana, horário, tipo e tema',
        parameters: z.object({
          daysBack: z.number().optional().describe('Período em dias para análise (default: 30)'),
        }),
        execute: async (params: unknown) => {
          const { daysBack = 30 } = params as { daysBack?: number }
          const supabase = getAdminClient()

          const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

          const { data: publishedContent } = await supabase
            .from('generated_content')
            .select('content, target_platform, status, published_at, review_score')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .gte('published_at', since)
            .order('published_at', { ascending: false })

          if (!publishedContent?.length) {
            return { message: 'Sem dados de conteúdo publicado neste período.' }
          }

          const metrics = this.computePerformanceMetrics(publishedContent)
          const insights = this.generateInsights(metrics, publishedContent)

          return {
            period: `${daysBack} dias`,
            ...metrics,
            topPerformer: metrics.topPerformer
              ? { ...metrics.topPerformer, content: metrics.topPerformer.content.slice(0, 200) }
              : null,
            ...insights,
          }
        },
      },
      {
        name: 'suggest_strategy_changes',
        description: 'Sugere mudanças estratégicas baseadas em dados de performance',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

          const { data: publishedContent } = await supabase
            .from('generated_content')
            .select('content, target_platform, status, published_at, review_score')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .gte('published_at', thirtyDaysAgo)

          if (!publishedContent?.length) {
            return { message: 'Sem dados suficientes para sugestões estratégicas.' }
          }

          const metrics = this.computePerformanceMetrics(publishedContent)

          // Use Claude to generate strategic recommendations
          const suggestResult = await generateSimpleText({
            model: modelOverride ?? this.config.defaultModel,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              'Analise estes dados e sugira mudanças estratégicas concretas.',
              '',
              `Posts publicados (30 dias): ${metrics.totalPublished}`,
              `Score médio: ${metrics.avgScore.toFixed(1)}`,
              `Por dia da semana: ${JSON.stringify(metrics.byDayOfWeek)}`,
              `Por tipo de conteúdo: ${JSON.stringify(metrics.byContentType)}`,
              `Por horário: ${JSON.stringify(metrics.byHour)}`,
              '',
              'Responda em JSON com: { topics_increase: string[], topics_decrease: string[], format_changes: string[], timing_adjustments: string[], tone_shifts: string[] }',
            ].join('\n'),
            maxTokens: 2048,
          })

          return parseAIJson(suggestResult.text, 'strategy-suggestions')
        },
      },
      {
        name: 'get_best_posting_times',
        description: 'Analisa timestamps de publicação vs engajamento para encontrar horários ótimos',
        parameters: z.object({
          daysBack: z.number().optional().describe('Período em dias (default: 30)'),
        }),
        execute: async (params: unknown) => {
          const { daysBack = 30 } = params as { daysBack?: number }
          const supabase = getAdminClient()

          const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

          const { data: publishedContent } = await supabase
            .from('generated_content')
            .select('published_at, review_score, target_platform')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .gte('published_at', since)

          if (!publishedContent?.length) {
            return { message: 'Sem dados suficientes para análise de horários.' }
          }

          // Group by hour and day of week
          const byHour: Record<string, { scores: number[]; count: number }> = {}
          const byDayHour: Record<string, { scores: number[]; count: number }> = {}

          for (const post of publishedContent) {
            if (!post.published_at) continue
            const date = new Date(post.published_at)
            const hour = date.getHours().toString().padStart(2, '0')
            const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
            const dayName = dayNames[date.getDay()]
            const score = Number(post.review_score) || 0

            if (!byHour[hour]) byHour[hour] = { scores: [], count: 0 }
            byHour[hour].scores.push(score)
            byHour[hour].count++

            const key = `${dayName} ${hour}h`
            if (!byDayHour[key]) byDayHour[key] = { scores: [], count: 0 }
            byDayHour[key].scores.push(score)
            byDayHour[key].count++
          }

          // Calculate averages and sort
          const hourlyAvg = Object.entries(byHour)
            .map(([hour, data]) => ({
              hour: `${hour}:00`,
              avgScore: Number((data.scores.reduce((a, b) => a + b, 0) / data.count).toFixed(1)),
              postCount: data.count,
            }))
            .sort((a, b) => b.avgScore - a.avgScore)

          const dayHourAvg = Object.entries(byDayHour)
            .map(([slot, data]) => ({
              slot,
              avgScore: Number((data.scores.reduce((a, b) => a + b, 0) / data.count).toFixed(1)),
              postCount: data.count,
            }))
            .sort((a, b) => b.avgScore - a.avgScore)

          return {
            bestHours: hourlyAvg.slice(0, 5),
            worstHours: hourlyAvg.slice(-3),
            bestSlots: dayHourAvg.slice(0, 10),
            totalPostsAnalyzed: publishedContent.length,
          }
        },
      },
      {
        name: 'competitor_analysis',
        description: 'Analisa perfis concorrentes no X/Twitter usando busca por handles',
        parameters: z.object({
          handles: z.array(z.string()).describe('Lista de handles do X/Twitter para analisar (ex: ["@handle1", "@handle2"])'),
        }),
        execute: async (params: unknown) => {
          const { handles } = params as { handles: string[] }

          // Use Claude to analyze competitor strategy based on handles
          const analysisResult = await generateSimpleText({
            model: modelOverride ?? this.config.defaultModel,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Analise a estratégia dos seguintes perfis concorrentes no X/Twitter: ${handles.join(', ')}`,
              '',
              'Com base no seu conhecimento sobre estratégias de conteúdo de tecnologia/IA no Brasil, forneça:',
              '1. Padrões de posting observáveis (frequência, horários, formatos)',
              '2. Tipos de conteúdo que eles provavelmente usam',
              '3. Estratégias de engajamento comuns nesse nicho',
              '4. O que podemos aprender e adaptar',
              '',
              'Nota: Se não tiver dados específicos em tempo real sobre estes perfis, forneça análise baseada em melhores práticas do nicho.',
              '',
              'Retorne JSON: { handles_analyzed: string[], patterns: string[], content_types: string[], engagement_strategies: string[], actionable_learnings: string[] }',
            ].join('\n'),
            maxTokens: 2048,
          })

          return parseAIJson(analysisResult.text, 'competitor-analysis')
        },
      },
      {
        name: 'audit_strategy',
        description: 'Audita se os ultimos 30 dias seguiram o framework de Content Pillars e identifica desequilibrios',
        parameters: z.object({
          daysBack: z.number().optional().describe('Periodo em dias (default: 30)'),
        }),
        execute: async (params: unknown) => {
          const { daysBack = 30 } = params as { daysBack?: number }
          const supabase = getAdminClient()
          const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

          const { data: posts } = await supabase
            .from('generated_content')
            .select('content, target_platform, target_format, review_score, published_at')
            .eq('workspace_id', ctx.workspaceId)
            .eq('status', 'published')
            .gte('published_at', since)
            .order('published_at', { ascending: false })

          if (!posts?.length) return { message: `Nenhum post publicado nos ultimos ${daysBack} dias.` }

          // Classify posts by content pillar (heuristic)
          const pillars = { educational: 0, thought_leadership: 0, curated: 0, engagement: 0 }
          for (const p of posts) {
            const c = (p.content as string).toLowerCase()
            if (c.includes('como ') || c.includes('tutorial') || c.includes('passo') || c.includes('guia')) {
              pillars.educational++
            } else if (c.includes('?') && c.length < 200) {
              pillars.engagement++
            } else if (c.includes('lancou') || c.includes('anunciou') || c.includes('publicou') || c.includes('segundo')) {
              pillars.curated++
            } else {
              pillars.thought_leadership++
            }
          }

          const total = posts.length
          const distribution = {
            educational: `${((pillars.educational / total) * 100).toFixed(0)}% (ideal: 40%)`,
            thought_leadership: `${((pillars.thought_leadership / total) * 100).toFixed(0)}% (ideal: 25%)`,
            curated: `${((pillars.curated / total) * 100).toFixed(0)}% (ideal: 20%)`,
            engagement: `${((pillars.engagement / total) * 100).toFixed(0)}% (ideal: 15%)`,
          }

          // Platform distribution
          const byPlatform: Record<string, number> = {}
          for (const p of posts) {
            byPlatform[p.target_platform] = (byPlatform[p.target_platform] ?? 0) + 1
          }

          // Avg score
          const avgScore = posts.reduce((sum: number, p: any) => sum + (Number(p.review_score) || 0), 0) / total

          return {
            totalPosts: total,
            period: `${daysBack} dias`,
            pillarDistribution: distribution,
            platformDistribution: byPlatform,
            avgReviewScore: avgScore.toFixed(1),
            imbalances: Object.entries(pillars)
              .filter(([, count]) => count / total > 0.6)
              .map(([pillar]) => `${pillar} com mais de 60% — reequilibrar`),
          }
        },
      },
    ]
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private computePerformanceMetrics(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    publishedContent: any[]
  ): PerformanceMetrics {
    if (!publishedContent.length) {
      return {
        totalPublished: 0,
        avgScore: 0,
        topPerformer: null,
        byDayOfWeek: {},
        byContentType: {},
        byHour: {},
      }
    }

    const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

    const byDayOfWeek: Record<string, { count: number; totalScore: number }> = {}
    const byContentType: Record<string, { count: number; totalScore: number }> = {}
    const byHour: Record<string, { count: number; totalScore: number }> = {}

    let totalScore = 0
    let topPerformer: PerformanceMetrics['topPerformer'] = null

    for (const post of publishedContent) {
      const score = Number(post.review_score) || 0
      totalScore += score

      if (!topPerformer || score > topPerformer.score) {
        topPerformer = {
          content: String(post.content ?? ''),
          score,
          platform: String(post.target_platform ?? 'unknown'),
        }
      }

      // Group by day of week
      if (post.published_at) {
        const date = new Date(post.published_at)
        const dayName = dayNames[date.getDay()]

        if (!byDayOfWeek[dayName]) byDayOfWeek[dayName] = { count: 0, totalScore: 0 }
        byDayOfWeek[dayName].count++
        byDayOfWeek[dayName].totalScore += score

        // Group by hour
        const hour = `${date.getHours().toString().padStart(2, '0')}h`
        if (!byHour[hour]) byHour[hour] = { count: 0, totalScore: 0 }
        byHour[hour].count++
        byHour[hour].totalScore += score
      }

      // Group by content type (platform as proxy)
      const platform = String(post.target_platform ?? 'unknown')
      if (!byContentType[platform]) byContentType[platform] = { count: 0, totalScore: 0 }
      byContentType[platform].count++
      byContentType[platform].totalScore += score
    }

    // Convert totalScore to avgScore in each group
    const toAvg = (groups: Record<string, { count: number; totalScore: number }>) =>
      Object.fromEntries(
        Object.entries(groups).map(([key, val]) => [
          key,
          { count: val.count, avgScore: Number((val.totalScore / val.count).toFixed(1)) },
        ])
      )

    return {
      totalPublished: publishedContent.length,
      avgScore: totalScore / publishedContent.length,
      topPerformer,
      byDayOfWeek: toAvg(byDayOfWeek),
      byContentType: toAvg(byContentType),
      byHour: toAvg(byHour),
    }
  }

  private generateInsights(metrics: PerformanceMetrics, publishedContent?: any[]): {
    insights: string[]
    recommendations: string[]
  } {
    const insights: string[] = []
    const recommendations: string[] = []

    if (metrics.totalPublished === 0) {
      insights.push('Nenhum conteúdo publicado no período analisado.')
      recommendations.push('Iniciar publicação de conteúdo para gerar dados de performance.')
      return { insights, recommendations }
    }

    insights.push(`${metrics.totalPublished} posts publicados com score médio de ${metrics.avgScore.toFixed(1)}.`)

    // Find best day
    const dayEntries = Object.entries(metrics.byDayOfWeek)
    if (dayEntries.length > 0) {
      const bestDay = dayEntries.sort((a, b) => b[1].avgScore - a[1].avgScore)[0]
      insights.push(`Melhor dia: ${bestDay[0]} (score médio: ${bestDay[1].avgScore}, ${bestDay[1].count} posts).`)
      recommendations.push(`Priorizar publicações em ${bestDay[0]} para maximizar engajamento.`)
    }

    // Find best hour
    const hourEntries = Object.entries(metrics.byHour)
    if (hourEntries.length > 0) {
      const bestHour = hourEntries.sort((a, b) => b[1].avgScore - a[1].avgScore)[0]
      insights.push(`Melhor horário: ${bestHour[0]} (score médio: ${bestHour[1].avgScore}).`)
      recommendations.push(`Concentrar posts no horário das ${bestHour[0]} para melhor performance.`)
    }

    // Find best content type
    const typeEntries = Object.entries(metrics.byContentType)
    if (typeEntries.length > 1) {
      const bestType = typeEntries.sort((a, b) => b[1].avgScore - a[1].avgScore)[0]
      insights.push(`Melhor plataforma/formato: ${bestType[0]} (score médio: ${bestType[1].avgScore}).`)
      recommendations.push(`Aumentar produção para ${bestType[0]} que apresenta melhor performance.`)
    }

    // Top performer
    if (metrics.topPerformer) {
      insights.push(`Top post: score ${metrics.topPerformer.score} em ${metrics.topPerformer.platform}.`)
    }

    // Week-over-week trend
    if (publishedContent?.length) {
      const thisWeek = publishedContent.filter((p: any) => {
        const age = (Date.now() - new Date(p.published_at ?? p.created_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        return age <= 1
      }).length
      const lastWeek = publishedContent.filter((p: any) => {
        const age = (Date.now() - new Date(p.published_at ?? p.created_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
        return age > 1 && age <= 2
      }).length

      if (thisWeek > 0 && lastWeek > 0) {
        const change = ((thisWeek - lastWeek) / lastWeek * 100).toFixed(0)
        insights.push(`Tendencia semanal: ${thisWeek} posts esta semana vs ${lastWeek} semana passada (${Number(change) > 0 ? '+' : ''}${change}%)`)
      }

      // Posting consistency
      if (lastWeek > 0 && thisWeek > 0) {
        const variance = Math.abs(thisWeek - lastWeek) / Math.max(thisWeek, lastWeek)
        if (variance > 0.3) {
          recommendations.push(`Inconsistencia na frequencia: variacao de ${(variance * 100).toFixed(0)}% entre semanas. Manter ritmo constante melhora o algoritmo.`)
        }
      }
    }

    return { insights, recommendations }
  }

  // ---------------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------------

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const details = result.details as Record<string, unknown>
    const calendarCreated = Number(details.calendarEntriesCreated ?? 0)
    const hasInsights = Array.isArray(details.insights) && (details.insights as string[]).length > 0

    let score = 5
    if (result.success) score += 2
    if (calendarCreated >= 5) score += 1.5
    if (calendarCreated >= 7) score += 0.5
    if (hasInsights) score += 1

    const issues: string[] = []
    if (!result.success) issues.push('Execução com erros')
    if (calendarCreated === 0) issues.push('Nenhuma entrada criada no calendário')
    if (!hasInsights) issues.push('Nenhum insight gerado')

    return {
      agentSlug: 'social-strategist',
      inputSummary: `Análise de performance + plano editorial`,
      outputSummary: `${calendarCreated} entradas no calendário, ${(details.insights as string[] | undefined)?.length ?? 0} insights`,
      autoScore: Math.min(score, 10),
      dimensions: {
        dataAnalysis: hasInsights ? 9 : 4,
        planQuality: calendarCreated >= 5 ? 9 : calendarCreated > 0 ? 6 : 2,
        executionReliability: result.success ? 9 : 3,
      },
      issues,
      verdict: score >= 7 ? 'keep' : score >= 5 ? 'improve' : 'reject',
    }
  }

  // ---------------------------------------------------------------------------
  // Telegram report
  // ---------------------------------------------------------------------------

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>
    const perf = d.performance as { totalPublished: number; avgScore: number; topPerformerScore: number | null } | undefined
    const calendarPreview = d.calendarPreview as Array<{ date: string; theme: string; type: string; platform: string }> | undefined
    const insights = d.insights as string[] | undefined
    const recommendations = d.recommendations as string[] | undefined

    const status = result.success ? '✅' : '❌'

    const lines = [
      `${status} *Social Media Strategist*`,
      '',
      '📊 *Performance (7 dias):*',
      `• Posts publicados: ${perf?.totalPublished ?? 0}`,
      `• Score médio: ${perf?.avgScore ?? 'N/A'}`,
      `• Top score: ${perf?.topPerformerScore ?? 'N/A'}`,
    ]

    // Editorial plan preview
    if (calendarPreview?.length) {
      lines.push('', '📅 *Próximos itens planejados:*')
      for (const item of calendarPreview.slice(0, 5)) {
        lines.push(`• ${item.date} — ${item.theme} (${item.type}, ${item.platform})`)
      }
    }

    // Key insight
    if (insights?.length) {
      lines.push('', '💡 *Insight principal:*')
      lines.push(insights[0])
    }

    // Top recommendation
    if (recommendations?.length) {
      lines.push('', '🎯 *Recomendação:*')
      lines.push(recommendations[0])
    }

    if (result.errors.length > 0) {
      lines.push('', `⚠️ Erros: ${result.errors.join(', ')}`)
    }

    return lines.join('\n')
  }
}

export const agent = new SocialStrategistAgent()
