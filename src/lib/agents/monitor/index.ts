import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Monitor Agent — SECOND in the pipeline (after Curator).
 *
 * Instead of inventing topics from thin air, the Monitor now:
 * 1. Loads recent REAL curated tweets (from Curator)
 * 2. Uses AI to ANALYZE and GROUP them into trending topics
 * 3. Each topic is backed by real tweets — not invented
 */
class MonitorAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'monitor',
      name: 'Monitor',
      role: 'monitor',
      description: 'Extrai trending topics reais a partir de tweets curados pelo Curator',
      defaultModel: 'deepseek-chat',
      pipelineStage: 2,
      maxActionsPerHour: 30,
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    let tokensUsed = 0

    // 1. Load recent curated_content (last 24h)
    const windowHours = Number(ctx.settings?.monitor_curated_window_hours ?? 24)
    const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

    let curatedItems: Array<{ id: string; source_author: string; source_content: string; source_url: string | null; source_metrics: Record<string, unknown> | null }> = []
    try {
      const { data, error } = await supabase
        .from('curated_content')
        .select('id, source_author, source_content, source_url, source_metrics')
        .eq('workspace_id', ctx.workspaceId)
        .gte('created_at', since)
        .order('relevance_score', { ascending: false })
        .limit(50)

      if (error) throw error
      curatedItems = (data ?? []) as typeof curatedItems
    } catch (err) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [`Failed to load curated content: ${err instanceof Error ? err.message : String(err)}`],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: {},
      }
    }

    if (curatedItems.length === 0) {
      return {
        success: true,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: ['No curated content found in the last ' + windowHours + 'h — run Curator first'],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_curated_content' },
      }
    }

    // 2. Build a summary of curated tweets for AI analysis
    const tweetSummaries = curatedItems.map((item, i) => {
      const metrics = item.source_metrics as Record<string, number> | null
      const likes = metrics?.likes ?? 0
      const retweets = metrics?.retweets ?? 0
      return `[${i + 1}] @${item.source_author} (${likes} likes, ${retweets} RTs): ${item.source_content.slice(0, 300)}`
    }).join('\n')

    // 3. Use AI to analyze and group real tweets into topics
    const result = await generateSimpleText({
      model: ctx.dbConfig?.model ?? this.config.defaultModel,
      systemPrompt: `Voce e um analista de inteligencia de tendencias tech/IA de nivel PhD. Sua missao e identificar SINAIS REAIS de tendencias emergentes a partir de tweets verificados.

REGRA ABSOLUTA: Voce NAO inventa tendencias. Voce APENAS agrupa e sintetiza o que os tweets EXPLICITAMENTE dizem. Se o padrao nao for claro em 3+ tweets, declare o topico como "insufficient_signal" e exclua-o da analise. NUNCA conecte tweets nao relacionados para criar uma narrativa artificial.

## METODOLOGIA DE ANALISE

Para cada topico identificado, avalie 5 dimensoes:

### 1. VOLUME (peso 25%)
- 1-2 tweets: sinal fraco (isolado)
- 3-4 tweets: sinal moderado (cluster)
- 5+ tweets: sinal forte (widespread)

### 2. VELOCIDADE (peso 25%)
- Todos os tweets sao das ultimas 6h? → "acelerando" (publicar AGORA)
- Espalhados em 12-24h? → "estavel" (pode planejar)
- Apenas tweets antigos (24h+)? → "declinando" (prioridade baixa)

### 3. AUTORIDADE (peso 20%)
- Fontes: contas verificadas, researchers conhecidos, contas oficiais de empresas → alta
- Fontes: influencers tech, newsletters → media
- Fontes: contas pequenas, anonimas → baixa

Hierarquia de fontes:
- ALTA: Contas oficiais (OpenAI, Google, Anthropic, Meta AI, Microsoft), pesquisadores verificados
- MEDIA: Influencers tech conhecidos (@karpathy, @ylecun, @AndrewYNg), newsletters
- BAIXA: Contas anonimas, bots, contas com <1000 seguidores

### 4. NOVIDADE (peso 15%)
- Evento/anuncio que aconteceu hoje → alta
- Discussao sobre tema recorrente com angulo novo → media
- Tema ja amplamente coberto, sem novidade → baixa

### 5. ACIONABILIDADE (peso 15%)
- Podemos criar conteudo UNICO e VALIOSO sobre isso? → alta
- Podemos comentar mas sem angulo diferenciado? → media
- Ja foi coberto por todos, nada a adicionar? → baixa

signal_score = (volume * 0.25) + (velocidade * 0.25) + (autoridade * 0.20) + (novidade * 0.15) + (acionabilidade * 0.15)
Escala: cada dimensao de 1 a 5. Score final de 1.0 a 5.0.

## CATEGORIAS (use EXATAMENTE uma):
- "model_release": Novo modelo, versao ou capability (GPT-5, Claude 4, Gemini 2)
- "benchmark_result": Resultado de benchmark, comparacao, ou avaliacao
- "product_launch": Novo produto, feature, ou servico de empresa
- "research_paper": Paper academico, descoberta cientifica
- "industry_move": Aquisicao, parceria, funding, regulacao, layoff
- "developer_tools": Nova ferramenta, framework, SDK, ou CLI
- "open_source": Release de projeto open source, milestone
- "ai_safety": Alignment, regulacao, etica, risco existencial
- "market_trend": Tendencia de mercado, adocao, pricing, economia
- "tutorial_insight": Dica pratica, how-to, best practice compartilhada

## DETECCAO DE NARRATIVA
- "narrativa": Os tweets contam uma HISTORIA em evolucao (evento que se desenrola ao longo das horas)
- "reacoes": Opinioes isoladas sobre um mesmo tema (nao conectadas entre si)
Narrativas sao MAIS VALIOSAS para conteudo — permitem posts com arco temporal.

## ANGULO DE CONTEUDO
Para cada topico, sugira UM angulo unico que podemos usar:
- Que perspectiva podemos trazer que os tweets originais NAO trouxeram?
- Temos experiencia pratica para comentar com autoridade?

## FILTRO DE AUDIENCIA

Nosso publico conhece: ChatGPT, Claude, Gemini, Perplexity, Copilot, Midjourney, Grok.
Nosso publico NAO conhece: nomes de papers arxiv, modelos experimentais obscuros,
frameworks de ML como LangChain, RAG, RLHF, LoRA, benchmarks tecnicos (SWE-bench, MMLU),
ferramentas de infra como DiLoCo, Hermes Vault, vLLM, etc.

Ao avaliar ACIONABILIDADE, use esta regra:
- Um leigo conseguiria entender o topico sem explicacao previa? → alta acionabilidade
- Requer contexto tecnico avancado para fazer sentido? → baixa acionabilidade
- Menciona produto/empresa conhecida (OpenAI, Google, Apple, Elon Musk, Meta)? → alta
- E uma dica pratica de uso, novidade de produto ou aplicacao nova de IA? → alta

PRIORIZE estas categorias: tutorial_insight, product_launch, market_trend
DESPRIORITIZE estas categorias: research_paper, benchmark_result, developer_tools, open_source
(Se nao houver opcao melhor, inclua tecnico — mas que tenha angulo acessivel para o publico geral)

## REGRAS
- APENAS topicos com evidencia real nos tweets fornecidos
- NAO invente, NAO extrapole alem do que os dados mostram
- Minimo 3, maximo 7 topicos
- Se nao houver tendencias claras, retorne menos topicos (qualidade > quantidade)

DEDUP TEMPORAL: Se um topic com titulo similar ja foi detectado nas ultimas 48h, marque velocity como "update" em vez de criar novo topic.

QUALIDADE > QUANTIDADE: Se os tweets nao sustentam pelo menos 3 topics com signal_score > 2.5, retorne menos topics. Retornar [] e melhor que inventar topics fracos.

## FORMATO DE SAIDA
Retorne APENAS JSON array valido:
[{
  "title": "string max 100 chars — evento/anuncio especifico",
  "description": "2-3 frases resumindo o que os tweets dizem",
  "relevance": "alta|media|baixa",
  "category": "uma das 10 categorias acima",
  "source_tweets": [1, 3, 7],
  "hashtags": ["#tag1", "#tag2"],
  "signal_score": 3.8,
  "velocity": "acelerando|estavel|declinando",
  "narrative_type": "narrativa|reacoes",
  "content_angle": "string — angulo unico sugerido para nosso conteudo"
}]`,
      userMessage: `Here are ${curatedItems.length} real tweets collected from X:\n\n${tweetSummaries}\n\nIdentify 3-5 distinct trending topics from these tweets. Each topic MUST be backed by at least one tweet.`,
      maxTokens: 3000,
    })

    tokensUsed = result.tokensUsed

    // 4. Parse AI response
    let topics: Array<{
      title: string
      description: string
      relevance: string
      category: string
      source_tweets: number[]
      hashtags: string[]
      signal_score?: number
      velocity?: string
      narrative_type?: string
      content_angle?: string
    }> = []

    try {
      topics = parseAIJson<typeof topics>(result.text, 'monitor topics from curated')
    } catch (err) {
      return {
        success: false,
        itemsProcessed: curatedItems.length,
        itemsProduced: 0,
        errors: [err instanceof Error ? err.message : 'JSON parse failed'],
        tokensUsed,
        costEstimate: tokensUsed * 0.0000003,
        durationMs: Date.now() - startTime,
        details: { rawResponse: result.text.slice(0, 500), curatedCount: curatedItems.length },
      }
    }

    // Validate
    topics = topics.filter(t =>
      t.title && t.description &&
      ['alta', 'media', 'baixa'].includes(t.relevance) &&
      Array.isArray(t.source_tweets) && t.source_tweets.length > 0
    )

    const maxTopics = Number(ctx.settings?.monitor_max_topics ?? 7)
    topics = topics.slice(0, maxTopics)

    if (topics.length === 0) {
      return {
        success: false,
        itemsProcessed: curatedItems.length,
        itemsProduced: 0,
        errors: ['No valid topics extracted from curated content'],
        tokensUsed,
        costEstimate: tokensUsed * 0.0000003,
        durationMs: Date.now() - startTime,
        details: { rawResponse: result.text.slice(0, 500), curatedCount: curatedItems.length },
      }
    }

    // 5. Dedup against existing topics
    const dedupWindowHours = Number(ctx.settings?.topic_dedup_window_hours ?? 24)
    const dedupSince = new Date(Date.now() - dedupWindowHours * 60 * 60 * 1000).toISOString()

    let existingTitles = new Set<string>()
    try {
      const { data: existingTopics } = await supabase
        .from('trending_topics')
        .select('title')
        .eq('workspace_id', ctx.workspaceId)
        .gte('detected_at', dedupSince)

      existingTitles = new Set(
        (existingTopics ?? []).map((t: { title: string }) => t.title.toLowerCase())
      )
    } catch (err) {
      // Non-fatal: proceed without dedup
      console.warn('[monitor] Failed to load existing topics for dedup:', err)
    }

    const newTopics = topics.filter(t => !existingTitles.has(t.title.toLowerCase()))

    // 6. Insert new topics with source references
    if (newTopics.length > 0) {
      const rows = newTopics.map(t => {
        // Map source_tweet indices back to curated_content IDs
        const backedByIds = t.source_tweets
          .filter(idx => idx >= 1 && idx <= curatedItems.length)
          .map(idx => curatedItems[idx - 1].id)

        return {
          workspace_id: ctx.workspaceId,
          title: t.title,
          description: t.description,
          relevance: t.relevance || 'media',
          source: 'curated_analysis',
          category: t.category,
          hashtags: t.hashtags || [],
          status: 'new',
          metadata: {
            backed_by_curated_ids: backedByIds,
            source_tweet_count: t.source_tweets?.length ?? 0,
            signal_score: t.signal_score ?? null,
            velocity: t.velocity ?? null,
            narrative_type: t.narrative_type ?? null,
            content_angle: t.content_angle ?? null,
          },
          expires_at: new Date(Date.now() + Number(ctx.settings?.topic_expiry_hours ?? 24) * 60 * 60 * 1000).toISOString(),
        }
      })

      try {
        const { error: insertError } = await supabase.from('trending_topics').insert(rows)
        if (insertError) {
          return {
            success: false,
            itemsProcessed: curatedItems.length,
            itemsProduced: 0,
            errors: [`Failed to insert topics: ${insertError.message}`],
            tokensUsed,
            costEstimate: tokensUsed * 0.0000003,
            durationMs: Date.now() - startTime,
            details: { curatedCount: curatedItems.length, topicsExtracted: topics.length },
          }
        }
      } catch (err) {
        return {
          success: false,
          itemsProcessed: curatedItems.length,
          itemsProduced: 0,
          errors: [`Insert failed: ${err instanceof Error ? err.message : String(err)}`],
          tokensUsed,
          costEstimate: tokensUsed * 0.0000003,
          durationMs: Date.now() - startTime,
          details: { curatedCount: curatedItems.length, topicsExtracted: topics.length },
        }
      }
    }

    return {
      success: true,
      itemsProcessed: curatedItems.length,
      itemsProduced: newTopics.length,
      errors: [],
      tokensUsed,
      costEstimate: tokensUsed * 0.0000003,
      durationMs: Date.now() - startTime,
      details: {
        curatedContentAnalyzed: curatedItems.length,
        topicsExtracted: topics.length,
        newTopics: newTopics.length,
        duplicatesSkipped: topics.length - newTopics.length,
        topicItems: topics.map(t => ({
          title: t.title,
          relevance: t.relevance,
          backedByTweets: t.source_tweets.length,
          isNew: !existingTitles.has(t.title.toLowerCase()),
          signal_score: t.signal_score ?? null,
          velocity: t.velocity ?? null,
        })),
      },
    }
  }

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const curatedCount = (d.curatedContentAnalyzed as number) ?? 0
    const newCount = (d.newTopics as number) ?? 0
    return {
      agentSlug: 'monitor',
      inputSummary: `${curatedCount} curated tweets analyzed`,
      outputSummary: `${d.topicsExtracted} topics extracted, ${newCount} new`,
      autoScore: newCount >= 3 ? 8 : newCount > 0 ? 6 : 3,
      dimensions: {
        discovery: newCount >= 3 ? 9 : newCount > 0 ? 6 : 3,
        grounding: curatedCount > 0 ? 9 : 2, // Topics are grounded in real data
        dedup: ((d.duplicatesSkipped as number) ?? 0) === 0 ? 10 : 7,
      },
      issues: result.errors,
      verdict: newCount > 0 ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>
    if (!result.success) {
      return `❌ *Monitor* — Erro: ${result.errors[0]}`
    }

    if ((d.curatedContentAnalyzed as number) === 0) {
      return '🔍 *Monitor* — Sem conteúdo curado para analisar. Execute o Curador primeiro.'
    }

    const topicItems = (d.topicItems as Array<{ title: string; relevance: string; backedByTweets: number; isNew: boolean; signal_score: number | null; velocity: string | null }>) ?? []
    const relevanceEmoji: Record<string, string> = { alta: '🔴', media: '🟡', baixa: '🟢' }
    const duplicatesSkipped = (d.duplicatesSkipped as number) ?? 0

    const lines = [
      '🔍 *Monitor — Topics Extraídos de Tweets Reais*',
      '',
      `📊 ${d.curatedContentAnalyzed} tweets analisados → ${d.topicsExtracted} topics (${d.newTopics} novos)`,
      '',
    ]

    for (const item of topicItems) {
      if (item.isNew) {
        const emoji = relevanceEmoji[item.relevance] ?? '🟡'
        const signalStr = item.signal_score != null ? `, signal: ${item.signal_score}` : ''
        const velocityEmoji = item.velocity === 'acelerando' ? ' ⚡ acelerando' : item.velocity === 'declinando' ? ' 🐌 declinando' : item.velocity === 'estavel' ? ' ➡️ estavel' : ''
        lines.push(`${emoji} ${item.title} _(${item.backedByTweets} tweets${signalStr}${velocityEmoji})_`)
      }
    }

    if (duplicatesSkipped > 0) {
      lines.push(`♻️ _${duplicatesSkipped} duplicado${duplicatesSkipped > 1 ? 's' : ''} ignorado${duplicatesSkipped > 1 ? 's' : ''}_`)
    }

    lines.push('')
    lines.push(`⏱️ ${(result.durationMs / 1000).toFixed(1)}s | 🪙 ${result.tokensUsed} tokens`)

    return lines.join('\n')
  }
}

export const agent = new MonitorAgent()
