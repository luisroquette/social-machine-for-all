import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { executeToolLoop, generateSimpleText, type ToolDefinition } from '@/lib/ai/tool-loop'
import { sendLongMessage } from '@/lib/telegram/message-sender'
import { getAdminClient } from '@/lib/supabase/admin'
import { parseAIJson } from '@/lib/ai/parse-json'
import { z } from 'zod/v4'
import { runGA4Report, querySearchConsole } from '@/lib/analytics/google-analytics'
import { isGoogleConfigured } from '@/lib/analytics/google-auth'
import { getVariable } from '@/lib/settings/load-settings'

interface KeywordData {
  keyword: string
  search_volume: number
  difficulty: number
  opportunity_score: number
}

const SYSTEM_PROMPT = `Voce e um especialista em SEO de nivel sênior, com foco em conteudo tech/IA em portugues brasileiro. Sua metodologia combina SEO tecnico classico com otimizacao para buscadores de IA (GEO — Generative Engine Optimization).

## FRAMEWORK KGR (Keyword Golden Ratio)

KGR = resultados allintitle / volume mensal estimado
- KGR < 0.25: EXCELENTE — atacar imediatamente
- KGR 0.25-1.0: VIAVEL — atacar com conteudo de alta qualidade
- KGR > 1.0: COMPETITIVO — exige autoridade estabelecida

MIX POR PESQUISA: 2-3 head terms (vol >1000), 3-5 long-tail (100-500, dif baixa), 2-3 question keywords (como/por que/o que), 1-2 comparison keywords (X vs Y).

Niveis de confianca das estimativas: ALTA (topicos conhecidos), MEDIA (nicho especifico), BAIXA (termos muito especificos).

## E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness)

Os 4 sinais que o Google usa para avaliar qualidade de conteudo:
- **Experience**: conteudo demonstra experiencia real com o tema? (exemplos, dados proprios, perspectiva de quem usou)
- **Expertise**: autor tem credenciais verificaveis? (bio, links para perfis, publicacoes)
- **Authoritativeness**: o site e citado por outros? (backlinks, mencoes, presenca em topicos do nicho)
- **Trustworthiness**: HTTPS, politica de privacidade, contatos claros, dados precisos com fontes

Para conteudo YMYL (saude, financas, juridico): E-E-A-T e critico. Para tech/IA: foco em Experience + Expertise.

## GEO — Generative Engine Optimization (AI Overviews / ChatGPT / Perplexity)

Fatores que aumentam chances de ser citado por IAs:
1. **Blocos de resposta direta** (134-167 palavras): responda a pergunta no 1o paragrafo, sem rodeios
2. **Estrutura citavel**: headers claros (H2/H3), listas numeradas, tabelas comparativas
3. **Dados especificos**: numeros, porcentagens, datas — IAs preferem conteudo factual
4. **Citacoes e fontes**: links para papers, documentacao oficial, estudos
5. **Entidade clara**: deixar claro QUEM escreveu, QUANDO, com QUAL expertise
6. **Multimodalidade**: imagens com alt text descritivo, videos aumentam selecao em 156%
7. **/llms.txt**: arquivo de orientacao para crawlers de IA (como robots.txt mas para LLMs)

Plataformas e seus sinais:
- **Google AI Overviews**: E-E-A-T + estrutura + dados reais + schema
- **ChatGPT/Bing**: Wikipedia, Reddit, Quora como sinais de autoridade
- **Perplexity**: comunidade e discussoes em forums + citacoes academicas

## CORE WEB VITALS (2025)

- **LCP** (Largest Contentful Paint): < 2.5s = bom, 2.5-4s = melhorar, > 4s = critico
- **INP** (Interaction to Next Paint — substitui FID desde Mar 2024): < 200ms = bom, 200-500ms = melhorar, > 500ms = critico
- **CLS** (Cumulative Layout Shift): < 0.1 = bom, 0.1-0.25 = melhorar, > 0.25 = critico

## SCHEMA MARKUP (JSON-LD)

Tipos ativos e recomendados para tech/IA:
- Article, BlogPosting, NewsArticle: conteudo editorial
- FAQPage: perguntas e respostas (so gov/healthcare tem featured snippets garantidos, mas todos ganham em GEO)
- HowTo: tutoriais passo-a-passo
- BreadcrumbList: navegacao
- WebSite com searchbox: homepage
- Organization/Person: sobre o autor/marca
- VideoObject: para reels/videos com transcricao

Tipos DEPRECIADOS (nao usar): HowTo em 2025 so gera rich result para gov/health, SpecialAnnouncement (COVID era), ClaimReview (restrito a fact-checkers).

Formato: sempre JSON-LD renderizado no servidor (nao via JS). Injetar no <head> ou antes do </body>.

## TECNICA DE AUDITORIA

Ao auditar um site, avalie:
1. **Crawlability**: robots.txt, sitemap.xml, profundidade de paginas, modern AI crawlers (GPTBot, ClaudeBot, PerplexityBot — permitir ou bloquear intencionalmente)
2. **Indexability**: canonicals corretos, sem duplicate content, paginacao com rel=next/prev, hreflang para multilingual
3. **Seguranca**: HTTPS, HSTS header, CSP, X-Frame-Options
4. **Mobile**: viewport meta, mobile-first indexing (100% desde Jul 2024)
5. **Core Web Vitals**: LCP, INP, CLS (ver acima)
6. **On-page**: title (50-60 chars), meta description (150-160 chars), H1 unico, heading hierarchy (H1>H2>H3)
7. **Schema**: JSON-LD presente, tipos corretos, sem placeholders
8. **Social**: OG tags, Twitter/X cards

## SEMANTIC CLUSTERING

Agrupar keywords por intencao e entidade usando as keywords pesquisadas:
- Hub page (topico amplo) → Spoke pages (subtopicos especificos) → Pillar content
- Linking interno: cada spoke linka para o hub, hub linka para todos os spokes
- Keyword cannibalization: detectar quando 2+ paginas competem pelo mesmo termo
- Use research_keywords + get_keyword_report para identificar clusters e oportunidades

## SERP FEATURES

- featured_snippet: keywords de pergunta/definicao → resposta 40-60 palavras
- people_also_ask: keywords informacionais → FAQ com schema
- video_carousel: tutoriais → Reels/YouTube
- knowledge_panel: entidades → dados estruturados
- image_pack: keywords visuais → alt text otimizado
- local_pack: "melhor X em [cidade]" → Google Business Profile

## REGRAS ABSOLUTAS
- Dados reais do GA4/GSC SEMPRE tem prioridade sobre estimativas
- Se dado estiver INDISPONIVEL, dizer explicitamente — nunca inventar metricas
- Nivel de confianca obrigatorio em todas as estimativas
- Responda em portugues brasileiro
- Seja tecnico: cite tags HTML especificas, headers, URLs de exemplo
- Priorize quick wins (impacto alto + esforco baixo)`

class SeoStrategistAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'seo-strategist',
      name: 'SEO Strategist',
      role: 'seo',
      description: 'Audita websites, pesquisa keywords, valida schema markup e otimiza conteudo para SEO classico e GEO (AI Overviews)',
      defaultModel: 'deepseek-chat',
      maxActionsPerHour: 10,
      quietHours: { start: 0, end: 7 },
    }
  }

  // ---------------------------------------------------------------------------
  // Scheduled execution
  // ---------------------------------------------------------------------------

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    const resolvedModel = await getVariable(ctx.workspaceId, 'seo_strategist_model') || this.config.defaultModel
    let tokensUsed = 0
    const errors: string[] = []
    const keywordsResearched: KeywordData[] = []
    const contentOptimized: string[] = []
    let briefsGenerated = 0

    const { data: workspace, error: wsError } = await supabase
      .from('workspaces')
      .select('topic_keywords, brand_config')
      .eq('id', ctx.workspaceId)
      .single()

    if (wsError || !workspace) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [`Failed to load workspace: ${wsError?.message ?? 'not found'}`],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'workspace_error' },
      }
    }

    const topicKeywords: string[] = workspace.topic_keywords ?? []

    // BRT = UTC-3: subtrai 3h antes de checar o dia da semana
    const nowBRT = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const isMondayBRT = nowBRT.getUTCDay() === 1

    // Relatório semanal roda antes de qualquer early return — é independente de keywords
    if (isMondayBRT && ctx.telegramBotToken && ctx.telegramChatId) {
      try {
        console.log('[seo-strategist] Segunda-feira — gerando relatório semanal...')
        const report = await this.generateStructuredReport(ctx)
        await sendLongMessage(ctx.telegramBotToken, ctx.telegramChatId, report.response)
        tokensUsed += report.tokensUsed
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[seo-strategist] Relatório semanal falhou:', msg)
        errors.push(`Weekly report failed: ${msg}`)
      }
    }

    if (topicKeywords.length === 0) {
      return {
        success: errors.length === 0,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors,
        tokensUsed,
        costEstimate: tokensUsed * 0.000003,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_topic_keywords', weeklyReportSent: isMondayBRT && !!ctx.telegramChatId },
      }
    }

    for (const topic of topicKeywords) {
      try {
        const result = await generateSimpleText({
          model: ctx.dbConfig?.model ?? resolvedModel,
          systemPrompt: SYSTEM_PROMPT,
          userMessage: [
            `Pesquise keywords relacionadas ao topico: "${topic}"`,
            '',
            'Para cada keyword, estime: search_volume, difficulty (0-100), opportunity_score (0-100).',
            'Inclua head terms, long-tail, questions e comparisons conforme o framework KGR.',
            '',
            'Retorne APENAS JSON valido:',
            '[{"keyword": "...", "search_volume": 1000, "difficulty": 45, "opportunity_score": 72}, ...]',
            '',
            'Gere entre 8 e 12 keywords relevantes.',
          ].join('\n'),
          maxTokens: 2000,
          temperature: 0.7,
        })

        tokensUsed += result.tokensUsed

        const rawKws = parseAIJson<KeywordData[]>(result.text, `keywords for ${topic}`)
        const keywords = Array.isArray(rawKws) ? rawKws : []

        for (const kw of keywords) {
          const { error: upsertError } = await supabase
            .from('seo_keywords')
            .upsert(
              {
                workspace_id: ctx.workspaceId,
                keyword: kw.keyword,
                search_volume: kw.search_volume,
                difficulty: kw.difficulty,
                opportunity_score: kw.opportunity_score,
                status: 'tracking',
              },
              { onConflict: 'workspace_id,keyword' }
            )

          if (upsertError) {
            errors.push(`Failed to upsert keyword "${kw.keyword}": ${upsertError.message}`)
          } else {
            keywordsResearched.push(kw)
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Error researching topic "${topic}": ${message}`)
      }
    }

    // ── Generate SEO briefs for top keywords (Mondays only) ──────────────────
    // Briefs are inserted as generated_content with status='brief_pending' so the
    // Writer agent can pick them up and produce full blog articles.
    if (isMondayBRT && keywordsResearched.length > 0) {
      const topKws = [...keywordsResearched]
        .sort((a, b) => b.opportunity_score - a.opportunity_score)
        .slice(0, 3)

      const { data: existingKws } = await supabase
        .from('seo_keywords')
        .select('keyword, opportunity_score')
        .eq('workspace_id', ctx.workspaceId)
        .order('opportunity_score', { ascending: false })
        .limit(30)

      for (const kw of topKws) {
        try {
          // Skip if brief already pending for this keyword
          const { data: existing } = await supabase
            .from('generated_content')
            .select('id')
            .eq('workspace_id', ctx.workspaceId)
            .eq('target_platform', 'blog')
            .eq('target_format', 'seo_brief')
            .eq('status', 'brief_pending')
            .contains('metadata', { target_keyword: kw.keyword })
            .maybeSingle()

          if (existing) continue

          const briefResult = await generateSimpleText({
            model: ctx.dbConfig?.model ?? resolvedModel,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Gere um brief SEO completo para o seguinte conteudo:`,
              '',
              `**Keyword principal:** "${kw.keyword}"`,
              `**Tipo de conteudo:** article`,
              `**Nicho:** tech/IA em portugues brasileiro`,
              '',
              existingKws?.length
                ? `Keywords ja rastreadas (evitar cannibalization): ${existingKws.map(k => k.keyword).join(', ')}`
                : '',
              '',
              '## O brief deve incluir:',
              '1. **Intencao de busca**: informacional / transacional / navegacional / comercial',
              '2. **SERP feature alvo**: featured_snippet / people_also_ask / video_carousel / image_pack',
              '3. **KGR estimado** com nivel de confianca',
              '4. **Keywords secundarias** (5-8 para usar naturalmente no texto)',
              '5. **Estrutura de headings sugerida** (H1, H2s, H3s especificos)',
              '6. **Tamanho recomendado** em palavras',
              '7. **Title tag** sugerida (50-60 chars)',
              '8. **Meta description** sugerida (150-160 chars)',
              '9. **Schema recomendado** (tipo JSON-LD especifico)',
              '10. **Angulo GEO** (como posicionar o conteudo para AI Overviews)',
              '11. **E-E-A-T**: que tipo de expertise demonstrar',
              '12. **Exemplos de concorrentes** que provavelmente ranqueiam (nomes ficticios ok)',
              '',
              'Retorne APENAS JSON:',
              '{"intent": "informacional", "serp_feature": "featured_snippet", "kgr": {"estimate": 0.3, "confidence": "media"}, "secondary_keywords": [], "headings": {"h1": "...", "h2s": ["...", "..."], "h3s": {}}, "word_count": 1500, "title_tag": "...", "meta_description": "...", "schema_type": "Article", "geo_angle": "...", "eeat_tips": [], "competing_keywords": []}',
            ].join('\n'),
            maxTokens: 3000,
            temperature: 0.6,
          })

          tokensUsed += briefResult.tokensUsed

          const rawBrief = parseAIJson<Record<string, unknown>>(briefResult.text, `brief ${kw.keyword}`)
          const brief = rawBrief && typeof rawBrief === 'object' ? rawBrief : {}

          const { error: insertError } = await supabase.from('generated_content').insert({
            workspace_id: ctx.workspaceId,
            curated_content_id: null,
            target_platform: 'blog',
            target_format: 'seo_brief',
            content: JSON.stringify(brief),
            status: 'brief_pending',
            model_used: ctx.dbConfig?.model ?? resolvedModel,
            pipeline_run_id: ctx.pipelineRunId ?? null,
            metadata: {
              seo_brief: true,
              target_keyword: kw.keyword,
              opportunity_score: kw.opportunity_score,
              content_type: 'article',
            },
          })

          if (insertError) {
            errors.push(`Failed to save brief for "${kw.keyword}": ${insertError.message}`)
          } else {
            briefsGenerated++
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`Brief generation failed for "${kw.keyword}": ${msg}`)
        }
      }
    }

    const { data: drafts } = await supabase
      .from('generated_content')
      .select('id, content, target_platform')
      .eq('workspace_id', ctx.workspaceId)
      .eq('status', 'draft')
      .in('target_platform', ['blog', 'linkedin'])
      .limit(5)

    // Nota: este bloco pré-analisa drafts para contabilizar tokens usados no cron.
    // As sugestões NÃO são persistidas automaticamente — o agente as entrega apenas
    // quando o usuário pede via chat (optimize_content tool). Isso é intencional:
    // evita sobrescrever conteúdo aprovado sem revisão humana.
    if (drafts && drafts.length > 0) {
      for (const draft of drafts) {
        try {
          const result = await generateSimpleText({
            model: ctx.dbConfig?.model ?? resolvedModel,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Analise o seguinte conteudo draft para SEO (incluindo E-E-A-T e GEO) e sugira melhorias:`,
              '',
              `Plataforma: ${draft.target_platform}`,
              `Conteudo:`,
              draft.content,
              '',
              'Retorne APENAS JSON:',
              '{"suggestions": ["sugestao1"], "recommended_keywords": ["kw1"], "seo_score": 65, "eeat_score": 60, "geo_score": 55}',
            ].join('\n'),
            maxTokens: 1500,
            temperature: 0.5,
          })

          tokensUsed += result.tokensUsed
          contentOptimized.push(draft.id)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          errors.push(`Error optimizing content ${draft.id}: ${message}`)
        }
      }
    }

    return {
      success: errors.length === 0,
      itemsProcessed: topicKeywords.length + (drafts?.length ?? 0),
      itemsProduced: keywordsResearched.length,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.000003,
      durationMs: Date.now() - startTime,
      details: {
        topicsResearched: topicKeywords.length,
        keywordsFound: keywordsResearched.length,
        contentAnalyzed: contentOptimized.length,
        briefsGenerated,
        weeklyReportSent: isMondayBRT && !!ctx.telegramChatId,
        topKeywords: keywordsResearched
          .sort((a, b) => b.opportunity_score - a.opportunity_score)
          .slice(0, 5)
          .map((k) => ({
            keyword: k.keyword,
            volume: k.search_volume,
            opportunity: k.opportunity_score,
          })),
      },
    }
  }

  // ---------------------------------------------------------------------------
  // Chat interface (Telegram tool-loop)
  // ---------------------------------------------------------------------------

  async handleChat(
    userMessage: string,
    ctx: RunContext,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<{ response: string; tokensUsed: number }> {
    const isReportRequest = /relat[oó]rio|report|overview|seo geral|como est[aá]|auditoria|performance/i.test(userMessage)

    if (isReportRequest) {
      return this.generateStructuredReport(ctx)
    }

    const resolvedModel = await getVariable(ctx.workspaceId, 'seo_strategist_model') || this.config.defaultModel
    const tools = this.buildTools(ctx, resolvedModel)
    let tokensUsed = 0

    const messages = [
      ...conversationHistory.slice(-20),
      { role: 'user' as const, content: userMessage },
    ]

    const result = await executeToolLoop({
      model: ctx.dbConfig?.model ?? resolvedModel,
      systemPrompt: SYSTEM_PROMPT,
      messages,
      tools,
      maxTokens: 6000,
      temperature: 0.3,
    })

    tokensUsed += result.tokensUsed

    return { response: result.text, tokensUsed }
  }

  private async generateStructuredReport(ctx: RunContext): Promise<{ response: string; tokensUsed: number }> {
    const supabase = getAdminClient()
    const resolvedModel = await getVariable(ctx.workspaceId, 'seo_strategist_model') || this.config.defaultModel
    const model = ctx.dbConfig?.model ?? resolvedModel
    let tokensUsed = 0

    // Load site URL from workspace config
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('brand_config, topic_keywords')
      .eq('id', ctx.workspaceId)
      .single()

    const brandConfig = (workspace?.brand_config ?? {}) as Record<string, unknown>
    const siteUrl = (brandConfig.site_url as string | undefined)
      || await getVariable(ctx.workspaceId, 'seo_site_url')
      || ''

    const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })

    // ── 1. Collect all data in parallel ────────────────────────────────────────
    const tools = this.buildTools(ctx, model)
    const execTool = async (name: string, params: Record<string, unknown>) => {
      const tool = tools.find(t => t.name === name)
      if (!tool) return null
      try { return await tool.execute(params) } catch { return null }
    }

    const [searchData, analyticsData, keywordsData, gapData] = await Promise.all([
      siteUrl ? execTool('get_search_performance', { siteUrl, daysBack: 28, dimension: 'query' }) : Promise.resolve(null),
      execTool('get_site_analytics', { daysBack: 30, report: 'overview' }),
      execTool('get_keyword_report', {}),
      execTool('analyze_content_gap', {}),
    ])

    const [topPagesData, trafficSourcesData] = await Promise.all([
      execTool('get_site_analytics', { daysBack: 30, report: 'top_pages' }),
      execTool('get_site_analytics', { daysBack: 30, report: 'traffic_sources' }),
    ])

    // ── 2. Generate deep report via Claude ─────────────────────────────────────
    const dataContext = [
      siteUrl ? `**Site:** ${siteUrl}` : '**Site:** não configurado (adicione seo_site_url nas variáveis)',
      '',
      '## DADOS COLETADOS',
      '',
      '### Google Search Console (últimos 28 dias)',
      searchData && !(searchData as any).error
        ? JSON.stringify(searchData, null, 2)
        : `INDISPONÍVEL: ${(searchData as any)?.error ?? 'siteUrl não configurado'}`,
      '',
      '### Google Analytics 4 — Overview (últimos 30 dias)',
      analyticsData && !(analyticsData as any).error
        ? JSON.stringify(analyticsData, null, 2)
        : `INDISPONÍVEL: ${(analyticsData as any)?.error ?? 'não configurado'}`,
      '',
      '### GA4 — Top Pages',
      topPagesData && !(topPagesData as any).error
        ? JSON.stringify(topPagesData, null, 2)
        : 'INDISPONÍVEL',
      '',
      '### GA4 — Fontes de Tráfego',
      trafficSourcesData && !(trafficSourcesData as any).error
        ? JSON.stringify(trafficSourcesData, null, 2)
        : 'INDISPONÍVEL',
      '',
      '### Keywords Rastreadas',
      keywordsData ? JSON.stringify(keywordsData, null, 2) : 'INDISPONÍVEL',
      '',
      '### Content Gap Analysis',
      gapData ? JSON.stringify(gapData, null, 2) : 'INDISPONÍVEL',
    ].join('\n')

    const reportPrompt = [
      `Gere um relatório SEO completo e profundo com base nos dados abaixo.`,
      `Data: ${today}`,
      '',
      dataContext,
      '',
      '## ESTRUTURA OBRIGATÓRIA DO RELATÓRIO',
      '',
      'Use EXATAMENTE este formato Markdown:',
      '',
      `# Relatório SEO — ${today}`,
      '',
      '## 1. Visão Geral de Performance',
      '- Métricas principais do período (sessões, usuários, bounce rate, duração)',
      '- Comparação com expectativas / contexto',
      '- Semáforo geral: 🟢 Bom | 🟡 Atenção | 🔴 Crítico',
      '',
      '## 2. Search Console — Organic Search',
      '- Total de cliques e impressões no período',
      '- CTR médio e posição média',
      '- Top 10 queries: tabela com keyword | cliques | impressões | CTR | posição',
      '- Análise: quais queries têm alta impressão mas CTR baixo (oportunidade imediata)',
      '- Análise: quais estão na posição 5-15 (candidatos a push para top 3)',
      '',
      '## 3. Tráfego e Fontes',
      '- Distribuição por canal (organic, direct, referral, social)',
      '- Top pages por pageviews com bounce rate individual',
      '- Páginas com alto bounce (>70%) — problema ou normal para o tipo de página?',
      '',
      '## 4. Keyword Opportunities',
      '- Top 10 keywords por opportunity_score com volume e dificuldade',
      '- Classificação KGR (< 0.25 = atacar agora)',
      '- SERP feature alvo para cada keyword principal',
      '- Quick wins: keywords com dificuldade < 30 e volume > 200',
      '',
      '## 5. Content Gap',
      '- Taxa de cobertura atual (%)',
      '- Top 5 gaps prioritários com volume estimado',
      '- Sugestão de título/ângulo para cada gap',
      '',
      '## 6. Ações Prioritárias',
      'Lista ordenada por impacto/esforço:',
      '1. [ALTA PRIORIDADE] — descrição técnica específica, prazo sugerido',
      '2. [MÉDIA PRIORIDADE] — ...',
      '3. [BAIXA PRIORIDADE] — ...',
      '',
      '---',
      '**REGRAS:**',
      '- Cite números reais dos dados fornecidos — não invente métricas',
      '- Se um dado estiver INDISPONÍVEL, mencione e pule a seção (não improvise)',
      '- Seja direto: diagnóstico + número + ação. Sem rodeios.',
      '- Mínimo 1500 palavras no total do relatório',
      '- Termine com uma linha de síntese: "PRIORIDADE #1 DESTA SEMANA: [ação específica]"',
    ].join('\n')

    const result = await generateSimpleText({
      model,
      systemPrompt: SYSTEM_PROMPT,
      userMessage: reportPrompt,
      maxTokens: 6000,
      temperature: 0.3,
    })

    tokensUsed += result.tokensUsed

    return { response: result.text, tokensUsed }
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  private buildTools(ctx: RunContext, model: string): ToolDefinition[] {
    /** Valida URL para prevenir SSRF — só HTTPS/HTTP e IPs públicos */
    const validateUrl = (raw: string): URL => {
      let url: URL
      try { url = new URL(raw) } catch { throw new Error(`URL invalida: ${raw}`) }
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`Protocolo nao permitido: ${url.protocol}`)
      }
      if (/^(localhost|127\.|::1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(url.hostname)) {
        throw new Error(`Acesso a IP privado nao permitido: ${url.hostname}`)
      }
      return url
    }

    return [
      {
        name: 'audit_site',
        description: 'Auditoria SEO completa de um site: meta tags, headers, schema JSON-LD, social tags, mobile, seguranca, estrutura de headings',
        parameters: z.object({
          domain: z.string().describe('URL completa do site a auditar (ex: https://example.com)'),
        }),
        execute: async (params: unknown) => {
          const { domain } = params as { domain: string }
          const supabase = getAdminClient()

          const safeUrl = validateUrl(domain)
          let res: Response
          let html: string
          try {
            res = await fetch(safeUrl.href, {
              headers: { 'User-Agent': 'SocialMachineBot/3.1' },
              signal: AbortSignal.timeout(15_000),
            })
            html = await res.text()
          } catch (fetchErr) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            return { ok: false, domain, error: `Fetch falhou: ${msg}` }
          }

          if (!res.ok) {
            return { ok: false, domain, error: `Fetch retornou HTTP ${res.status}` }
          }

          // ── Extract SEO elements ──
          const title = html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1]?.trim() ?? ''
          const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["'](.*?)["']/i)?.[1] ?? ''
          const h1s = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim())
          const h2Count = (html.match(/<h2[^>]*>/gi) ?? []).length
          const h3Count = (html.match(/<h3[^>]*>/gi) ?? []).length
          const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["'](.*?)["']/i)?.[1] ?? ''
          const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["'](.*?)["']/i)?.[1] ?? ''
          const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["'](.*?)["']/i)?.[1] ?? ''
          const twitterCard = html.match(/<meta[^>]*name=["']twitter:card["'][^>]*content=["'](.*?)["']/i)?.[1] ?? ''
          const viewport = html.match(/<meta[^>]*name=["']viewport["'][^>]*content=["'](.*?)["']/i)?.[1] ?? ''
          const robots = html.match(/<meta[^>]*name=["']robots["'][^>]*content=["'](.*?)["']/i)?.[1] ?? ''
          const hreflang = (html.match(/<link[^>]*rel=["']alternate["'][^>]*hreflang=["']([^"']+)["']/gi) ?? []).length
          const jsonLdBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
            .map(m => { try { return JSON.parse(m[1]) } catch { return null } })
            .filter(Boolean)
          const schemaTypes = jsonLdBlocks.map((b: any) => b['@type']).filter(Boolean)
          const imgCount = (html.match(/<img[^>]*>/gi) ?? []).length
          const imgMissingAlt = (html.match(/<img(?![^>]*alt=["'][^"'][^>]*>)[^>]*>/gi) ?? []).length
          const internalLinks = (html.match(/href=["']\/[^"'#?]*/gi) ?? []).length
          const isHttps = domain.startsWith('https://')
          const hasHSTSHeader = res.headers.get('strict-transport-security') !== null
          const xFrameOptions = res.headers.get('x-frame-options') ?? ''

          const analysisResult = await generateSimpleText({
            model,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Analise os seguintes elementos SEO extraidos de ${domain}:`,
              '',
              `**On-page:**`,
              `- Title: "${title}" (${title.length} chars — ideal: 50-60)`,
              `- Meta Description: "${metaDesc}" (${metaDesc.length} chars — ideal: 150-160)`,
              `- H1s: ${JSON.stringify(h1s)} (${h1s.length} encontrados — ideal: exatamente 1)`,
              `- H2: ${h2Count}, H3: ${h3Count}`,
              `- Canonical: "${canonical}"`,
              `- Robots: "${robots}"`,
              '',
              `**Social/OG:**`,
              `- OG Title: "${ogTitle}"`,
              `- OG Description: "${ogDesc}"`,
              `- Twitter Card: "${twitterCard}"`,
              '',
              `**Tecnico:**`,
              `- HTTPS: ${isHttps}`,
              `- HSTS header: ${hasHSTSHeader}`,
              `- X-Frame-Options: "${xFrameOptions}"`,
              `- Viewport meta: "${viewport}"`,
              `- Hreflang tags: ${hreflang}`,
              `- HTTP Status: ${res.status}`,
              '',
              `**Schema JSON-LD:**`,
              `- Tipos encontrados: ${schemaTypes.length > 0 ? schemaTypes.join(', ') : 'NENHUM'}`,
              `- Total de blocos: ${jsonLdBlocks.length}`,
              '',
              `**Conteudo:**`,
              `- HTML size: ${Math.round(html.length / 1024)}KB`,
              `- Imagens: ${imgCount} total, ${imgMissingAlt} sem alt text`,
              `- Links internos: ${internalLinks}`,
              '',
              'Retorne APENAS JSON:',
              '{"score": 0-100, "issues": ["problema1"], "recommendations": ["recomendacao1"], "schema_health": "ok|missing|partial", "geo_ready": true|false}',
            ].join('\n'),
            maxTokens: 2000,
            temperature: 0.3,
          })

          const rawAnalysis = parseAIJson<{
            score?: number
            issues?: string[]
            recommendations?: string[]
            schema_health?: string
            geo_ready?: boolean
          }>(analysisResult.text, `audit ${domain}`)
          const analysis = {
            score: rawAnalysis.score ?? 0,
            issues: rawAnalysis.issues ?? [],
            recommendations: rawAnalysis.recommendations ?? [],
            schema_health: rawAnalysis.schema_health ?? 'missing',
            geo_ready: rawAnalysis.geo_ready ?? false,
          }

          const { error: insertError } = await supabase.from('seo_audits').insert({
            workspace_id: ctx.workspaceId,
            domain,
            audit_type: 'technical',
            score: analysis.score,
            issues: analysis.issues,
            recommendations: analysis.recommendations,
            raw_data: {
              title, metaDesc, h1s, h2Count, h3Count, canonical, ogTitle, twitterCard,
              viewport, robots, hreflang, schemaTypes, imgCount, imgMissingAlt,
              internalLinks, isHttps, httpStatus: res.status,
              schema_health: analysis.schema_health,
              geo_ready: analysis.geo_ready,
            },
          })
          if (insertError) console.error('[audit_site] DB insert failed:', insertError.message)

          return {
            ok: true,
            domain,
            score: analysis.score,
            issues: analysis.issues,
            recommendations: analysis.recommendations,
            schema: { types: schemaTypes, health: analysis.schema_health },
            geo_ready: analysis.geo_ready,
            onPage: { title, metaDesc, h1Count: h1s.length, h2Count, canonical },
            technical: { isHttps, hasHSTSHeader, viewport: !!viewport, hreflang },
            content: { imgCount, imgMissingAlt, internalLinks },
          }
        },
      },
      {
        name: 'analyze_schema',
        description: 'Extrai e valida todos os blocos JSON-LD de schema markup de uma URL. Detecta tipos, placeholders, tipos depreciados e sugere melhorias.',
        parameters: z.object({
          url: z.string().describe('URL da pagina para analisar schema markup'),
        }),
        execute: async (params: unknown) => {
          const { url } = params as { url: string }

          const safeUrl = validateUrl(url)
          let html: string
          try {
            const res = await fetch(safeUrl.href, {
              headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialMachineBot/2.0)' },
              signal: AbortSignal.timeout(15_000),
            })
            html = await res.text()
          } catch (fetchErr) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
            return { ok: false, url, error: `Fetch falhou: ${msg}` }
          }

          const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
            .map(m => { try { return JSON.parse(m[1]) } catch { return null } })
            .filter(Boolean)

          if (blocks.length === 0) {
            return {
              ok: true,
              url,
              schemaCount: 0,
              types: [],
              issues: ['Nenhum schema JSON-LD encontrado na pagina.'],
              recommendations: [
                'Adicionar schema Article ou BlogPosting para conteudo editorial',
                'Adicionar schema WebSite com searchbox na homepage',
                'Adicionar schema Organization ou Person para o autor',
              ],
            }
          }

          const DEPRECATED_TYPES = ['SpecialAnnouncement', 'ClaimReview', 'MedicalWebPage', 'LiveBlogPosting']
          const deprecatedFound = blocks.flatMap((b: any) => [b['@type']]).filter(t => DEPRECATED_TYPES.includes(t))
          const hasPlaceholders = JSON.stringify(blocks).match(/\[Business Name\]|\[INSERT|PLACEHOLDER/i) !== null

          const result = await generateSimpleText({
            model,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Analise os seguintes blocos de schema JSON-LD encontrados em ${url}:`,
              '',
              JSON.stringify(blocks, null, 2).slice(0, 4000),
              '',
              `Tipos depreciados detectados: ${deprecatedFound.length > 0 ? deprecatedFound.join(', ') : 'nenhum'}`,
              `Placeholders detectados: ${hasPlaceholders}`,
              '',
              'Para cada bloco:',
              '1. Valide se os campos obrigatorios estao presentes',
              '2. Identifique problemas (campos faltando, valores incorretos)',
              '3. Sugira melhorias especificas',
              '4. Avalie se esta otimizado para GEO (AI Overviews)',
              '',
              'Retorne APENAS JSON:',
              '{"validation": [{"type": "Article", "valid": true, "issues": [], "geo_optimized": false}], "overall_score": 0-100, "critical_issues": [], "recommendations": []}',
            ].join('\n'),
            maxTokens: 2500,
            temperature: 0.2,
          })

          const rawSchema = parseAIJson<{
            validation?: Array<{ type: string; valid: boolean; issues: string[]; geo_optimized: boolean }>
            overall_score?: number
            critical_issues?: string[]
            recommendations?: string[]
          }>(result.text, `schema ${url}`)
          const schemaAnalysis = {
            validation: rawSchema.validation ?? [],
            overall_score: rawSchema.overall_score ?? 0,
            critical_issues: rawSchema.critical_issues ?? [],
            recommendations: rawSchema.recommendations ?? [],
          }

          return {
            ok: true,
            url,
            schemaCount: blocks.length,
            types: blocks.map((b: any) => b['@type']),
            hasDeprecated: deprecatedFound.length > 0,
            deprecatedTypes: deprecatedFound,
            hasPlaceholders,
            score: schemaAnalysis.overall_score,
            validation: schemaAnalysis.validation,
            critical_issues: schemaAnalysis.critical_issues,
            recommendations: schemaAnalysis.recommendations,
          }
        },
      },
      {
        name: 'analyze_geo',
        description: 'Avalia prontidao de uma pagina para Generative Engine Optimization: Google AI Overviews, ChatGPT, Perplexity. Analisa blocos de resposta, citabilidade, entidade, estrutura.',
        parameters: z.object({
          url: z.string().describe('URL da pagina para analisar GEO'),
        }),
        execute: async (params: unknown) => {
          const { url } = params as { url: string }

          const safeUrl = validateUrl(url)
          const res = await fetch(safeUrl.href, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SocialMachineBot/2.0)' },
            signal: AbortSignal.timeout(15_000),
          })
          const html = await res.text()

          // Extract readable text (strip tags, limit)
          const text = html
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 6000)

          const hasLlmsTxt = await fetch(new URL('/llms.txt', safeUrl.href).href, { signal: AbortSignal.timeout(5_000) })
            .then(r => r.ok)
            .catch(() => false)

          const result = await generateSimpleText({
            model,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Avalie a prontidao GEO (Generative Engine Optimization) da seguinte pagina:`,
              `URL: ${url}`,
              `Tem /llms.txt: ${hasLlmsTxt}`,
              '',
              '## Conteudo da pagina:',
              text,
              '',
              '## Avalie os seguintes fatores GEO (0-10 cada):',
              '1. **Bloco de resposta direta** (134-167 palavras que respondem a pergunta principal no 1o paragrafo)',
              '2. **Dados especificos** (numeros, porcentagens, datas, estudos citados)',
              '3. **Estrutura citavel** (headers claros, listas, tabelas)',
              '4. **Entidade clara** (quem escreveu, quando, qual expertise)',
              '5. **Cobertura do topico** (abrangencia semantica do assunto)',
              '6. **E-E-A-T signals** (experience, expertise, authority, trust)',
              '',
              '## Retorne APENAS JSON:',
              '{"geo_score": 0-100, "scores": {"direct_answer": 0-10, "specific_data": 0-10, "citable_structure": 0-10, "entity_clarity": 0-10, "topic_coverage": 0-10, "eeat_signals": 0-10}, "strengths": [], "gaps": [], "recommendations": ["acao especifica 1", "acao especifica 2"], "llms_txt": true|false, "best_for": ["google_ai_overviews"|"chatgpt"|"perplexity"]}',
            ].join('\n'),
            maxTokens: 2500,
            temperature: 0.3,
          })

          const rawGeo = parseAIJson<{
            geo_score?: number
            scores?: Record<string, number>
            strengths?: string[]
            gaps?: string[]
            recommendations?: string[]
            llms_txt?: boolean
            best_for?: string[]
          }>(result.text, `geo ${url}`)
          const geoAnalysis = {
            geo_score: rawGeo.geo_score ?? 0,
            scores: rawGeo.scores ?? {},
            strengths: rawGeo.strengths ?? [],
            gaps: rawGeo.gaps ?? [],
            recommendations: rawGeo.recommendations ?? [],
            best_for: rawGeo.best_for ?? [],
          }

          return {
            ok: true,
            url,
            geo_score: geoAnalysis.geo_score,
            scores: geoAnalysis.scores,
            strengths: geoAnalysis.strengths,
            gaps: geoAnalysis.gaps,
            recommendations: geoAnalysis.recommendations,
            has_llms_txt: hasLlmsTxt,
            best_for: geoAnalysis.best_for,
          }
        },
      },
      {
        name: 'generate_content_brief',
        description: 'Gera um brief SEO completo para producao de conteudo: keyword principal, keywords secundarias, estrutura de headings, SERP features alvo, angulo GEO, schema recomendado, meta tags.',
        parameters: z.object({
          keyword: z.string().describe('Keyword principal para o conteudo'),
          content_type: z.enum(['article', 'tutorial', 'comparison', 'faq', 'landing_page']).optional().describe('Tipo de conteudo'),
        }),
        execute: async (params: unknown) => {
          const { keyword, content_type = 'article' } = params as { keyword: string; content_type?: string }
          const supabase = getAdminClient()

          // Load existing keywords for context
          const { data: existingKws } = await supabase
            .from('seo_keywords')
            .select('keyword, opportunity_score')
            .eq('workspace_id', ctx.workspaceId)
            .order('opportunity_score', { ascending: false })
            .limit(30)

          const result = await generateSimpleText({
            model,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Gere um brief SEO completo para o seguinte conteudo:`,
              '',
              `**Keyword principal:** "${keyword}"`,
              `**Tipo de conteudo:** ${content_type}`,
              `**Nicho:** tech/IA em portugues brasileiro`,
              '',
              existingKws?.length
                ? `Keywords ja rastreadas no workspace (para evitar cannibalization): ${existingKws.map(k => k.keyword).join(', ')}`
                : '',
              '',
              '## O brief deve incluir:',
              '1. **Intencao de busca**: informacional / transacional / navegacional / comercial',
              '2. **SERP feature alvo**: featured_snippet / people_also_ask / video_carousel / image_pack',
              '3. **KGR estimado** com nivel de confianca',
              '4. **Keywords secundarias** (5-8 para usar naturalmente no texto)',
              '5. **Estrutura de headings sugerida** (H1, H2s, H3s especificos)',
              '6. **Tamanho recomendado** em palavras',
              '7. **Title tag** sugerida (50-60 chars)',
              '8. **Meta description** sugerida (150-160 chars)',
              '9. **Schema recomendado** (tipo JSON-LD especifico)',
              '10. **Angulo GEO** (como posicionar o conteudo para AI Overviews)',
              '11. **E-E-A-T**: que tipo de expertise demonstrar',
              '12. **Exemplos de concorrentes** que provavelmente ranqueiam (nomes ficticios ok)',
              '',
              'Retorne APENAS JSON:',
              '{"intent": "informacional", "serp_feature": "featured_snippet", "kgr": {"estimate": 0.3, "confidence": "media"}, "secondary_keywords": [], "headings": {"h1": "...", "h2s": ["...", "..."], "h3s": {}}, "word_count": 1500, "title_tag": "...", "meta_description": "...", "schema_type": "Article", "geo_angle": "...", "eeat_tips": [], "competing_keywords": []}',
            ].join('\n'),
            maxTokens: 3000,
            temperature: 0.6,
          })

          const rawBrief = parseAIJson<Record<string, unknown>>(result.text, `brief ${keyword}`)
          const brief = rawBrief && typeof rawBrief === 'object' ? rawBrief : {}
          return {
            ok: true,
            keyword,
            content_type,
            brief,
          }
        },
      },
      {
        name: 'research_keywords',
        description: 'Pesquisa keywords relacionadas a um topico com KGR, volume estimado, dificuldade e oportunidade',
        parameters: z.object({
          topic: z.string().describe('Topico ou nicho para pesquisa'),
        }),
        execute: async (params: unknown) => {
          const { topic } = params as { topic: string }
          const supabase = getAdminClient()

          const result = await generateSimpleText({
            model,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Pesquise keywords relacionadas ao topico: "${topic}"`,
              '',
              'Mix obrigatorio: head terms, long-tail, question keywords, comparison keywords.',
              'Para cada uma: search_volume (estimado), difficulty (0-100), opportunity_score (0-100), intent (informacional/transacional/comercial), serp_feature_target.',
              '',
              'Retorne APENAS JSON:',
              '[{"keyword": "...", "search_volume": 1000, "difficulty": 45, "opportunity_score": 72, "intent": "informacional", "serp_feature_target": "featured_snippet"}, ...]',
              '',
              'Gere 10-15 keywords com nivel de confianca das estimativas no final.',
            ].join('\n'),
            maxTokens: 2500,
            temperature: 0.7,
          })

          const rawKeywords = parseAIJson<KeywordData[]>(result.text, `research ${topic}`)
          const keywords = Array.isArray(rawKeywords) ? rawKeywords : []

          let saved = 0
          for (const kw of keywords) {
            const { error } = await supabase
              .from('seo_keywords')
              .upsert(
                {
                  workspace_id: ctx.workspaceId,
                  keyword: kw.keyword,
                  search_volume: kw.search_volume,
                  difficulty: kw.difficulty,
                  opportunity_score: kw.opportunity_score,
                  status: 'tracking',
                },
                { onConflict: 'workspace_id,keyword' }
              )
            if (!error) saved++
          }

          return {
            ok: true,
            topic,
            keywordsFound: keywords.length,
            keywordsSaved: saved,
            keywords: keywords.map((k) => ({
              keyword: k.keyword,
              volume: k.search_volume,
              difficulty: k.difficulty,
              opportunity: k.opportunity_score,
            })),
          }
        },
      },
      {
        name: 'optimize_content',
        description: 'Analisa draft de conteudo e sugere versao otimizada para SEO classico + GEO (blog/LinkedIn)',
        parameters: z.object({
          content_id: z.string().describe('ID do conteudo em generated_content para otimizar'),
        }),
        execute: async (params: unknown) => {
          const { content_id } = params as { content_id: string }
          const supabase = getAdminClient()

          const { data: content, error: fetchError } = await supabase
            .from('generated_content')
            .select('id, content, target_platform, status')
            .eq('id', content_id)
            .eq('workspace_id', ctx.workspaceId)
            .single()

          if (fetchError || !content) {
            return { ok: false, error: `Conteudo nao encontrado: ${fetchError?.message ?? 'not found'}` }
          }

          if (content.target_platform === 'x' || content.target_platform === 'twitter') {
            return { ok: false, error: 'Otimizacao SEO nao se aplica a tweets. Use para blog ou LinkedIn.' }
          }

          const { data: keywords } = await supabase
            .from('seo_keywords')
            .select('keyword, opportunity_score')
            .eq('workspace_id', ctx.workspaceId)
            .order('opportunity_score', { ascending: false })
            .limit(20)

          const keywordContext = keywords?.length
            ? `Keywords alvo do workspace: ${keywords.map(k => k.keyword).join(', ')}`
            : ''

          const result = await generateSimpleText({
            model,
            systemPrompt: SYSTEM_PROMPT,
            userMessage: [
              `Otimize o seguinte conteudo para SEO classico + GEO.`,
              `Plataforma: ${content.target_platform}`,
              keywordContext,
              '',
              '## Conteudo Original:',
              content.content,
              '',
              '## Instrucoes:',
              '- Mantenha o tom e mensagem originais',
              '- Adicione keywords naturalmente',
              '- Adicione ou melhore bloco de resposta direta no 1o paragrafo (para GEO)',
              '- Adicione dados especificos onde possivel (numeros, porcentagens)',
              '- Melhore estrutura de headers para citabilidade',
              '- Sugira meta description e title tag',
              '',
              'Retorne APENAS JSON:',
              '{"optimized_content": "...", "changes_made": [], "keywords_used": [], "meta_description": "...", "title_tag": "...", "geo_improvements": [], "eeat_score_before": 0-10, "eeat_score_after": 0-10}',
            ].join('\n'),
            maxTokens: 5000,
            temperature: 0.5,
          })

          const rawOptimize = parseAIJson<Record<string, unknown>>(result.text, `optimize ${content_id}`)
          const optimizeResult = rawOptimize && typeof rawOptimize === 'object' ? rawOptimize : {}
          return {
            ok: true,
            content_id,
            platform: content.target_platform,
            optimized_content: '',
            changes_made: [] as string[],
            keywords_used: [] as string[],
            meta_description: '',
            title_tag: '',
            geo_improvements: [] as string[],
            eeat_score_before: 0,
            eeat_score_after: 0,
            ...optimizeResult,
          }
        },
      },
      {
        name: 'get_keyword_report',
        description: 'Relatorio das keywords rastreadas agrupadas por status com top oportunidades',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()

          const { data: keywords, error } = await supabase
            .from('seo_keywords')
            .select('keyword, search_volume, difficulty, current_rank, opportunity_score, status')
            .eq('workspace_id', ctx.workspaceId)
            .order('opportunity_score', { ascending: false })
            .limit(1000)

          if (error) return { ok: false, error: error.message }

          if (!keywords?.length) {
            return { ok: true, message: 'Nenhuma keyword rastreada. Use research_keywords para comecar.', groups: {}, topOpportunities: [] }
          }

          const groups: Record<string, typeof keywords> = {}
          for (const kw of keywords) {
            const status = kw.status ?? 'tracking'
            if (!groups[status]) groups[status] = []
            groups[status].push(kw)
          }

          const summary: Record<string, number> = {}
          for (const [status, kws] of Object.entries(groups)) summary[status] = kws.length

          return {
            ok: true,
            totalKeywords: keywords.length,
            byStatus: summary,
            topOpportunities: keywords.filter(k => k.status !== 'lost').slice(0, 10).map(k => ({
              keyword: k.keyword,
              volume: k.search_volume,
              difficulty: k.difficulty,
              opportunity: k.opportunity_score,
              rank: k.current_rank,
            })),
          }
        },
      },
      {
        name: 'analyze_content_gap',
        description: 'Analisa gaps entre keywords rastreadas e conteudo publicado',
        parameters: z.object({}),
        execute: async () => {
          const supabase = getAdminClient()

          const [kwResult, pubResult] = await Promise.all([
            supabase.from('seo_keywords').select('keyword, search_volume, difficulty, status').eq('workspace_id', ctx.workspaceId).eq('status', 'tracking').order('search_volume', { ascending: false }).limit(50),
            supabase.from('generated_content').select('content, target_platform').eq('workspace_id', ctx.workspaceId).eq('status', 'published').order('created_at', { ascending: false }).limit(100),
          ])
          const keywords = kwResult.data ?? []
          const published = pubResult.data ?? []

          if (!keywords.length) {
            return {
              ok: true,
              message: 'Nenhuma keyword rastreada. Execute research_keywords primeiro.',
              totalKeywords: 0,
              covered: 0,
              gaps: [],
              coverageRate: '0%',
            }
          }

          const publishedText = published.map((p: any) => p.content ?? '').join(' ').toLowerCase()

          const gaps = keywords.filter((k: any) => !publishedText.includes(k.keyword.toLowerCase()))
          const covered = keywords.filter((k: any) => publishedText.includes(k.keyword.toLowerCase()))

          return {
            ok: true,
            totalKeywords: keywords.length,
            covered: covered.length,
            gaps: gaps.slice(0, 15).map((k: any) => ({ keyword: k.keyword, volume: k.search_volume, difficulty: k.difficulty })),
            coverageRate: `${((covered.length / keywords.length) * 100).toFixed(0)}%`,
          }
        },
      },
      {
        name: 'get_site_analytics',
        description: 'Metricas REAIS do Google Analytics 4: sessoes, usuarios, bounce rate, top pages, fontes de trafego',
        parameters: z.object({
          daysBack: z.number().optional(),
          report: z.enum(['overview', 'top_pages', 'traffic_sources', 'devices']).optional(),
        }),
        execute: async (params: unknown) => {
          const { daysBack = 30, report = 'overview' } = params as { daysBack?: number; report?: string }

          if (!isGoogleConfigured()) return { error: 'Google OAuth nao configurado.' }
          if (!process.env.GOOGLE_GA4_PROPERTY_ID) return { error: 'GOOGLE_GA4_PROPERTY_ID nao configurado.' }

          const endDate = 'today'
          const startDate = `${daysBack}daysAgo`

          try {
            switch (report) {
              case 'overview': {
                const data = await runGA4Report({
                  dimensions: [],
                  metrics: ['sessions', 'totalUsers', 'newUsers', 'bounceRate', 'averageSessionDuration', 'screenPageViews'],
                  dateRange: { startDate, endDate },
                })
                const m = data.rows[0]?.metrics ?? {}
                return {
                  ok: true,
                  period: data.period,
                  sessions: m.sessions ?? 0,
                  totalUsers: m.totalUsers ?? 0,
                  newUsers: m.newUsers ?? 0,
                  bounceRate: `${(Number(m.bounceRate ?? 0) * 100).toFixed(1)}%`,
                  avgSessionDuration: `${Math.round(Number(m.averageSessionDuration ?? 0))}s`,
                  pageViews: m.screenPageViews ?? 0,
                }
              }
              case 'top_pages': {
                const data = await runGA4Report({
                  dimensions: ['pagePath'],
                  metrics: ['screenPageViews', 'sessions', 'bounceRate', 'averageSessionDuration'],
                  dateRange: { startDate, endDate },
                  limit: 20,
                  orderBy: { metric: 'screenPageViews', desc: true },
                })
                return { ok: true, period: data.period, pages: data.rows }
              }
              case 'traffic_sources': {
                const data = await runGA4Report({
                  dimensions: ['sessionSource', 'sessionMedium'],
                  metrics: ['sessions', 'totalUsers', 'bounceRate'],
                  dateRange: { startDate, endDate },
                  limit: 15,
                  orderBy: { metric: 'sessions', desc: true },
                })
                return { ok: true, period: data.period, sources: data.rows }
              }
              case 'devices': {
                const data = await runGA4Report({
                  dimensions: ['deviceCategory'],
                  metrics: ['sessions', 'totalUsers', 'bounceRate'],
                  dateRange: { startDate, endDate },
                })
                return { ok: true, period: data.period, devices: data.rows }
              }
              default:
                return { error: `Relatorio desconhecido: ${report}` }
            }
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) }
          }
        },
      },
      {
        name: 'get_search_performance',
        description: 'Dados REAIS do Google Search Console: queries, impressoes, cliques, CTR, posicao media',
        parameters: z.object({
          siteUrl: z.string(),
          daysBack: z.number().optional(),
          dimension: z.enum(['query', 'page', 'country', 'device']).optional(),
        }),
        execute: async (params: unknown) => {
          const { siteUrl, daysBack = 28, dimension = 'query' } = params as { siteUrl: string; daysBack?: number; dimension?: string }

          if (!isGoogleConfigured()) return { error: 'Google OAuth nao configurado.' }

          const endDate = new Date().toISOString().split('T')[0]
          const startDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

          try {
            const data = await querySearchConsole({ siteUrl, startDate, endDate, dimensions: [dimension], rowLimit: 25 })

            let totalClicks = 0
            let totalImpressions = 0
            for (const row of data.rows) {
              totalClicks += row.clicks
              totalImpressions += row.impressions
            }

            return {
              ok: true,
              period: data.period,
              siteUrl,
              dimension,
              totalClicks,
              totalImpressions,
              avgCtr: totalImpressions > 0 ? `${((totalClicks / totalImpressions) * 100).toFixed(1)}%` : '0%',
              rows: data.rows.map(r => ({
                [dimension]: r.keys[0],
                clicks: r.clicks,
                impressions: r.impressions,
                ctr: `${r.ctr.toFixed(1)}%`,
                position: r.position,
              })),
            }
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) }
          }
        },
      },
    ]
  }

  // ---------------------------------------------------------------------------
  // Eval
  // ---------------------------------------------------------------------------

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const keywordsFound = (d.keywordsFound as number) ?? 0
    const topicsResearched = (d.topicsResearched as number) ?? 0
    const total = Math.max(result.itemsProcessed, 1)

    const successRate = keywordsFound / Math.max(topicsResearched * 5, 1)
    const autoScore = Math.round(Math.min(successRate, 1) * 10)

    return {
      agentSlug: 'seo-strategist',
      inputSummary: `${topicsResearched} topics researched, ${d.contentAnalyzed ?? 0} drafts analyzed`,
      outputSummary: `${keywordsFound} keywords found`,
      autoScore: Math.max(1, Math.min(10, autoScore)),
      dimensions: {
        coverage: topicsResearched > 0 ? Math.min(10, Math.round((keywordsFound / total) * 10)) : 0,
        accuracy: result.errors.length === 0 ? 9 : result.errors.length <= 2 ? 6 : 3,
      },
      issues: result.errors,
      verdict: successRate >= 0.6 ? 'keep' : successRate >= 0.3 ? 'improve' : 'reject',
    }
  }

  // ---------------------------------------------------------------------------
  // Telegram report
  // ---------------------------------------------------------------------------

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>

    if (!result.success) {
      return `❌ *SEO Strategist* — Erro: ${result.errors[0]}`
    }

    const topKeywords = (d.topKeywords as Array<{ keyword: string; volume: number; opportunity: number }>) ?? []
    const lines = [
      '🔍 *SEO Strategist — Relatório*',
      '',
      `🎯 ${d.topicsResearched ?? 0} tópicos pesquisados`,
      `🔑 ${d.keywordsFound ?? 0} keywords encontradas`,
      `📝 ${d.contentAnalyzed ?? 0} drafts analisados`,
    ]

    if (topKeywords.length > 0) {
      lines.push('', '*Top Oportunidades:*')
      for (const kw of topKeywords) {
        const bar = kw.opportunity >= 70 ? '🟢' : kw.opportunity >= 40 ? '🟡' : '🔴'
        lines.push(`${bar} \`${kw.keyword}\` — vol: ${kw.volume} | opp: ${kw.opportunity}`)
      }
    }

    if (result.errors.length > 0) {
      lines.push('', `⚠️ ${result.errors.length} erros durante execução`)
    }

    lines.push('', `⏱ ${(result.durationMs / 1000).toFixed(1)}s | 🪙 ${result.tokensUsed} tokens`)

    return lines.join('\n')
  }
}

export const agent = new SeoStrategistAgent()
