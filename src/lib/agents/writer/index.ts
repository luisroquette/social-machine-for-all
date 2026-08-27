import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import { getAdminClient } from '@/lib/supabase/admin'
import { hasDraftForCuratedItem } from '@/lib/pipeline/dedup'
import { loadXBackpressure } from '@/lib/pipeline/x-backpressure'
import { loadPlatformConfigs, type PlatformConfig } from '@/lib/settings/platform-config'
import { getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { loadWorkspaceFeatures, type WorkspaceFeatures } from '@/lib/config/workspace-features'
import { buildEngagementInsights } from '@/lib/eval/engagement-insights'
import type { Json } from '@/lib/supabase/database.types'

interface CuratedItem {
  id: string
  workspace_id: string
  topic_id: string
  source_platform: string
  source_url: string | null
  source_author: string | null
  source_content: string
  relevance_score: number
  score_breakdown?: Record<string, unknown>
  status?: string
  source_metrics?: {
    has_media?: boolean
    media_urls?: string[]
    media_types?: string[]
    reel_eligible?: boolean
    video_url?: string
    stored_video_url?: string
    [key: string]: unknown
  }
}

interface GeneratedDraft {
  curatedId: string
  platform: string
  title: string
  content: string
  format: string
}

/** Maps EV B2B taxonomy category → a focus instruction injected into the writer's userMessage. */
function evCategoryFocus(category: string): string {
  const map: Record<string, string> = {
    ev_technical:      'FOCO: protocolo OCPP, instalação técnica, integradores, engenheiros de TI e gestores de infraestrutura. Escreva em PT-BR. Termos de protocolo (OCPP, CCS2, V2G) podem ser mantidos.',
    ev_fleet:          'FOCO: ROI de frota, TCO (custo total de posse), eficiência operacional, gestores de logística e frotas. Escreva em PT-BR.',
    ev_infrastructure: 'FOCO: caso de negócio para condomínio/shopping/posto — redução de IPTU, receita passiva, valorização do imóvel. Escreva em PT-BR.',
    ev_regulatory:     'FOCO: oportunidade regulatória, compliance, vantagem de first-mover, decisores públicos e gestores de compliance. Escreva em PT-BR.',
    ev_market_br:      'FOCO: mercado brasileiro, contexto nacional, PT-BR, dados do setor no Brasil. Escreva em PT-BR.',
    ev_launch:         'FOCO: novidade do setor, specs do produto/modelo, impacto prático para frotas e operadores B2B. Escreva em PT-BR.',
    ev_news:           'FOCO: contexto EV B2B geral, relevância para empresas e gestores no Brasil. Escreva em PT-BR.',
    seasonal:          'FOCO: data comemorativa institucional — tom mais humano/emocional que venda direta, mas sem perder a identidade Brand. Use OBRIGATORIAMENTE o ângulo editorial e a restrição (se houver) indicados na FONTE acima como fio condutor do post. Escreva em PT-BR.',
  }
  return map[category] ?? 'FOCO: mobilidade elétrica B2B, público empresarial e gestores. Escreva em PT-BR.'
}

class WriterAgent extends BaseAgent {
  private _resolvedMaxActionsPerHour: number | null = null

  get config(): AgentConfig {
    return {
      slug: 'writer',
      name: 'Redator',
      role: 'writer',
      description: 'Transforma conteudo curado em posts para redes sociais',
      defaultModel: 'deepseek-chat',
      pipelineStage: 3,
      maxActionsPerHour: this._resolvedMaxActionsPerHour ?? 30,
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    // Time guard: stop gracefully before Vercel function timeout (maxDuration=300s)
    const MAX_EXECUTION_MS = 90_000 // 90 seconds — conservative, well within 300s maxDuration
    let tokensUsed = 0
    const errors: string[] = []
    const draftsCreated: GeneratedDraft[] = []

    // Load configurable settings
    const writerModel = await getVariable(ctx.workspaceId, 'writer_model') || this.config.defaultModel
    const maxExecutionMs = await getNumericVariable(ctx.workspaceId, 'writer_max_execution_ms') || 90_000
    this._resolvedMaxActionsPerHour = await getNumericVariable(ctx.workspaceId, 'writer_max_actions_per_hour') || 30
    const features = await loadWorkspaceFeatures(ctx.workspaceId)

    // ── Process pending SEO briefs from SEO Strategist ───────────────────────
    // SEO Strategist deposits briefs with status='brief_pending', target_format='seo_brief'.
    // Writer generates the full blog article and updates the row to status='draft'.
    // This runs BEFORE platform_configs check — it's independent of social platforms.
    if (Date.now() - startTime < MAX_EXECUTION_MS) {
      const { data: seoBriefs } = await supabase
        .from('generated_content')
        .select('id, content, metadata')
        .eq('workspace_id', ctx.workspaceId)
        .eq('status', 'brief_pending')
        .eq('target_platform', 'blog')
        .eq('target_format', 'seo_brief')
        .order('created_at', { ascending: true })
        .limit(3)

      for (const brief of seoBriefs ?? []) {
        if (Date.now() - startTime > MAX_EXECUTION_MS) break

        try {
          const briefData = JSON.parse(brief.content) as Record<string, unknown>
          const meta = (brief.metadata ?? {}) as Record<string, unknown>
          const targetKeyword = (meta.target_keyword as string | undefined) ?? ''
          const wordCount = (briefData.word_count as number | undefined) ?? 1500

          const systemPrompt = this.buildBlogSystemPrompt(briefData, targetKeyword)
          const result = await generateSimpleText({
            model: ctx.dbConfig?.model ?? this.config.defaultModel,
            systemPrompt,
            userMessage: [
              `Escreva um artigo completo em portugues brasileiro seguindo o brief acima.`,
              `Keyword principal: "${targetKeyword}"`,
              `Tamanho alvo: aproximadamente ${wordCount} palavras.`,
              ``,
              `Retorne o artigo em Markdown. Comece diretamente com o H1 — sem preambulo, sem explicacoes.`,
              `Nao inclua frontmatter YAML. Nao inclua bloco de metadados. Apenas o conteudo do artigo.`,
            ].join('\n'),
            maxTokens: 4000,
            temperature: 0.7,
          })
          tokensUsed += result.tokensUsed

          const schemaType = (briefData.schema_type as string | undefined) ?? 'Article'
          const titleTag = (briefData.title_tag as string | undefined) ?? targetKeyword
          const metaDescription = (briefData.meta_description as string | undefined) ?? ''

          await supabase.from('generated_content').update({
            content: result.text,
            target_format: schemaType.toLowerCase(),
            status: 'draft',
            model_used: ctx.dbConfig?.model ?? this.config.defaultModel,
            metadata: {
              ...meta,
              title_tag: titleTag,
              meta_description: metaDescription,
              secondary_keywords: briefData.secondary_keywords ?? [],
              schema_type: schemaType,
            } as unknown as Json,
          }).eq('id', brief.id)

          draftsCreated.push({
            curatedId: '',
            platform: 'blog',
            title: titleTag,
            content: result.text.slice(0, 100),
            format: schemaType.toLowerCase(),
          })
        } catch (err) {
          errors.push(`SEO brief writing failed for ${brief.id}: ${err instanceof Error ? err.message : 'unknown'}`)
        }
      }
    }

    // Load active platform configs (needed for social media drafts)
    const platformConfigs = await loadPlatformConfigs(ctx.workspaceId)

    if (!platformConfigs.length) {
      // If SEO briefs were processed, return those results instead of a hard error
      if (draftsCreated.length > 0) {
        return {
          success: errors.length === 0,
          itemsProcessed: draftsCreated.length,
          itemsProduced: draftsCreated.length,
          errors,
          tokensUsed,
          costEstimate: tokensUsed * 0.0000003,
          durationMs: Date.now() - startTime,
          details: {
            draftsCreated: draftsCreated.length,
            skippedDuplicates: 0,
            platformsUsed: ['blog'],
            drafts: draftsCreated.map(d => ({ platform: d.platform, title: d.title, format: d.format, content: d.content })),
            failedItems: errors.length,
          },
        }
      }
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [...errors, 'No active platform configs found for workspace'],
        tokensUsed,
        costEstimate: tokensUsed * 0.0000003,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_platform_configs' },
      }
    }

    // Load curated content — prioritize breaking, filter noise/opinion
    const writerLimit = Number(ctx.settings?.writer_max_items_per_run ?? 3)
    const { data: curatedItems, error: fetchError } = await supabase
      .from('curated_content')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('status', 'curated')
      .not('score_breakdown->>category', 'in', '("noise","opinion")')
      .order('relevance_score', { ascending: false })
      .limit(writerLimit)

    if (fetchError) {
      return {
        success: false,
        itemsProcessed: draftsCreated.length,
        itemsProduced: draftsCreated.length,
        errors: [`Failed to fetch curated content: ${fetchError.message}`, ...errors],
        tokensUsed,
        costEstimate: tokensUsed * 0.0000003,
        durationMs: Date.now() - startTime,
        details: { reason: 'fetch_error', draftsCreated: draftsCreated.length },
      }
    }

    // Also include archived reel-eligible videos from the last 7 days when enabled.
    // Videos curated in the last 7 days that were written as feed_post/carousel (before the
    // reel-always-wins fix) now have stored_video_url in source_metrics. Pick them up as
    // reel candidates even though their status is already 'written'.
    const itemsToProcess: CuratedItem[] = [...((curatedItems ?? []) as unknown as CuratedItem[])]
    if (features.video_reels) {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const { data: archivedVideoItems } = await supabase
        .from('curated_content')
        .select('*')
        .eq('workspace_id', ctx.workspaceId)
        .eq('status', 'written')
        .not('source_metrics->>stored_video_url', 'is', null)
        .gte('created_at', sevenDaysAgo)
        .order('relevance_score', { ascending: false })
        .limit(3)
      const existingIds = new Set(itemsToProcess.map(i => i.id))
      for (const archived of (archivedVideoItems ?? [])) {
        if (!existingIds.has(archived.id)) {
          itemsToProcess.push(archived as CuratedItem)
        }
      }
      if ((archivedVideoItems?.length ?? 0) > 0) {
        console.log(`[writer] Merged ${archivedVideoItems!.length} archived reel-eligible video(s) from last 7 days`)
      }
    }

    if (!itemsToProcess.length) {
      return {
        success: errors.length === 0,
        itemsProcessed: draftsCreated.length,
        itemsProduced: draftsCreated.length,
        errors,
        tokensUsed,
        costEstimate: tokensUsed * 0.0000003,
        durationMs: Date.now() - startTime,
        details: {
          reason: draftsCreated.length === 0 ? 'no_curated_content' : undefined,
          draftsCreated: draftsCreated.length,
          skippedDuplicates: 0,
          platformsUsed: draftsCreated.map(d => d.platform),
          drafts: draftsCreated.map(d => ({ platform: d.platform, title: d.title, format: d.format, content: d.content })),
          failedItems: errors.length,
        },
      }
    }

    // Process each curated item for each active platform
    // Time guard: stop gracefully before Vercel function timeout (maxDuration=300s)
    let skippedDuplicates = 0
    let timeoutReached = false
    const xBackpressure = new Map<'x' | 'thread', Awaited<ReturnType<typeof loadXBackpressure>>>()

    for (const item of itemsToProcess) {
      if (timeoutReached) break

      // Archived video items (status='written') were already written as feed_post/carousel.
      // In this pass we only generate an Instagram reel from their stored_video_url.
      const isArchivedVideoItem = item.status === 'written'

      let draftsForThisItem = 0
      let aiRejectionsForThisItem = 0

      for (const platformConfig of platformConfigs) {
        // Check time guard before each platform processing
        if (Date.now() - startTime > maxExecutionMs) {
          console.warn(`[writer] Time guard reached (${Math.round((Date.now() - startTime) / 1000)}s), stopping gracefully`)
          timeoutReached = true
          break
        }

        try {
          // Archived video items: only generate Instagram reel — skip all other platforms
          if (isArchivedVideoItem && platformConfig.platform !== 'instagram') continue

          // Skip if draft already exists. For archived items, check specifically for reel
          // drafts (they already have feed_post/carousel for instagram — we allow a reel too).
          if (isArchivedVideoItem) {
            const { count: reelCount } = await supabase
              .from('generated_content')
              .select('id', { count: 'exact', head: true })
              .eq('workspace_id', ctx.workspaceId)
              .eq('curated_content_id', item.id)
              .eq('target_format', 'reel')
              .neq('status', 'rejected')
            if ((reelCount ?? 0) > 0) { skippedDuplicates++; continue }
          } else if (await hasDraftForCuratedItem(ctx.workspaceId, item.id, platformConfig.platform)) {
            skippedDuplicates++
            continue
          }

          // ── CURATED VIDEO REEL — Instagram with reel-eligible video content ──
          const isReelEligible = item.source_metrics?.reel_eligible === true
          const isInstagram = platformConfig.platform === 'instagram'

          // Image generation is opt-in per workspace. Without it, skip Instagram safely.
          const supportsInstagramImages = features.instagram_image_generation

          if (isInstagram && !supportsInstagramImages) {
            continue
          }

          // ── YOUR BRAND FORMAT ROTATION — reel é 100% news, feed_post/carousel são 100% evergreen ──
          // Reels continuam vindo de qualquer fonte video-eligible (X/YouTube).
          // feed_post/carousel só nascem de source_platform='pillar' (semeado por
          // evergreen-seed-brand) ou 'seasonal' (semeado por seasonal-brand,
          // calendário de datas comemorativas) — notícia nunca mais vira feed_post/carousel.
          // Isso corrigiu a causa raiz da rejeição de ~91% dos carrosséis: ver
          // docs/superpowers/specs/2026-07-05-brand-evergreen-multiformat-design.md.
          let brandTargetFormat: 'feed_post' | 'carousel' | 'reel' | null = null
          if (supportsInstagramImages && features.evergreen_content && isInstagram) {
            // Prefer permanent stored_video_url (Supabase) over potentially-expired Twitter URL
            const videoUrl_ = item.source_metrics?.stored_video_url ?? item.source_metrics?.video_url
            if (isArchivedVideoItem || (isReelEligible && videoUrl_)) {
              // Archived items always become reels; fresh reel-eligible items too
              brandTargetFormat = 'reel'
            } else if (item.source_platform === 'pillar' || item.source_platform === 'seasonal') {
              const today = new Date().toISOString().slice(0, 10)
              const { count: todayDraftCount } = await supabase
                .from('generated_content')
                .select('id', { count: 'exact', head: true })
                .eq('workspace_id', ctx.workspaceId)
                .eq('target_platform', 'instagram')
                .gte('created_at', `${today}T00:00:00.000Z`)
              const slot = (todayDraftCount ?? 0) % 2
              brandTargetFormat = slot === 0 ? 'feed_post' : 'carousel'
            } else {
              // Non-video news item: Reels already claim video-eligible content via the
              // dedicated reels-prepare-brand cron; feed_post/carousel are evergreen-only.
              // Nothing left for this item on Instagram.
              continue
            }
          }

          // ── STANDARD TEXT GENERATION (posts, slideshows, etc.) ──
          const basePrompt = ctx.dbConfig?.system_prompt ?? this.buildPlatformPrompt(platformConfig, ctx, features)
          const examples = await this.getTopPerformingExamples(ctx.workspaceId, platformConfig.platform)
          const systemPrompt = basePrompt + examples

          // Detect source format to guide the writer's format choice
          const sourceText = item.source_content ?? ''
          const isXPlatform = platformConfig.platform === 'x' || platformConfig.platform === 'twitter'
          const sourceIsThread = isXPlatform && (
            sourceText.length > 280 ||
            /\b1\/\d+\b|\b1 of \d+\b|\b\(1\)/i.test(sourceText)
          )
          if (isXPlatform) {
            const format = sourceIsThread ? 'thread' : 'x'
            let pressure = xBackpressure.get(format)
            if (!pressure) {
              pressure = await loadXBackpressure(supabase, ctx.workspaceId, format)
              xBackpressure.set(format, pressure)
            }
            if (pressure.blocked) {
              errors.push(`X ${format} generation paused by backlog guard: ${pressure.reason}`)
              continue
            }
          }
          const formatInstruction = isXPlatform
            ? sourceIsThread
              ? `FORMATO OBRIGATÓRIO: Thread (fonte original é longa/thread). Use OPCAO B.`
              : `FORMATO OBRIGATÓRIO: Tweet único (fonte original é curta, ≤280 chars). Use OPCAO A.`
            : `Retorne APENAS JSON valido.`

          // Strip ALL URLs from source text for X — zero links policy (CLAUDE.md)
          // x.com links are also removed: they reveal the original source (Rule 4)
          const sourceTextForAI = isXPlatform
            ? sourceText
                .replace(/https?:\/\/\S+/gi, '')          // remove all https:// URLs
                .replace(/\bx\.com\/\S*/gi, '')            // remove bare x.com/... mentions
                .replace(/\btwitter\.com\/\S*/gi, '')      // remove bare twitter.com/... mentions
                .replace(/\s{2,}/g, ' ').trim()
            : sourceText

          // Prefer permanent stored_video_url (won't expire) over raw Twitter URL
          const videoUrl = item.source_metrics?.stored_video_url ?? (item.source_metrics?.video_url as string | undefined)

          // CTA roll: determinístico por item ID, ~25% dos posts com cta_content=true
          // terminam com "Comente [PALAVRA] aqui que te mando o link via DM."
          const ctaRoll = parseInt(item.id.replace(/-/g, '').slice(0, 8), 16) % 4 === 0

          const userMessage = [
            `Plataforma: ${platformConfig.platform.toUpperCase()}`,
            `Max: ${platformConfig.maxLength} chars — OBRIGATORIO: conte os caracteres. Nao ultrapasse.`,
            '',
            `FONTE (unica verdade — nao invente nada fora daqui):`,
            sourceTextForAI,
            '',
            (!isXPlatform && item.source_url && !/twitter\.com|x\.com/i.test(item.source_url)) ? `Link: ${item.source_url}` : '',
            '',
            // For Instagram workspaces with enabled image generation, force the configured format.
            (isInstagram && supportsInstagramImages && brandTargetFormat === 'reel' && videoUrl)
              ? `VIDEO_URL (inclua exatamente este valor no campo original_video_url do JSON): ${videoUrl}`
              : '',
            (isInstagram && supportsInstagramImages && brandTargetFormat)
              ? `FORMATO OBRIGATÓRIO: Gere exatamente o formato "${brandTargetFormat}" (ver system prompt para estrutura JSON). Nenhum outro formato é aceito nesta rodada.`
              : (isInstagram && isReelEligible && videoUrl)
                ? `FORMATO OBRIGATÓRIO: Use o formato reel/curated_video (ver system prompt).`
                : '',
            // EV taxonomy is optional and only active for workspaces that opt in.
            (features.ev_market_curation && item.score_breakdown?.category)
              ? `CATEGORIA DETECTADA: ${item.score_breakdown.category}\n${evCategoryFocus(String(item.score_breakdown.category))}`
              : '',
            `CHECKLIST ANTES DE RESPONDER (violar qualquer item = rejeicao automatica):`,
            `[ ] ZERO nomes proprios (pessoas, empresas, modelos, versoes) que nao aparecem LITERALMENTE na fonte acima`,
            `[ ] ZERO numeros, porcentagens ou benchmarks inventados`,
            `[ ] ZERO framing conspiratorio ("o que eles escondem", "eles tem medo de...", "o segredo que...")`,
            `[ ] ZERO especulacoes — se nao esta na fonte, nao escreva`,
            `[ ] Texto gerado cabe em ${platformConfig.maxLength} chars (nao mais)`,
            '',
            // CTA gatilho: ~1 em 4 posts com recurso distribuível terminam com o convite de follow+DM.
            // Determinístico por item ID para evitar que o mesmo post gere CTAs em runs repetidos.
            (isXPlatform && item.score_breakdown?.cta_content === true && ctaRoll)
              ? `CTA OBRIGATÓRIO NESTE POST: O conteúdo fonte menciona um recurso distribuível (repo/guia/lista/template). TERMINE o post com exatamente uma frase no estilo: "Comente [PALAVRA] aqui que te mando o link via DM." — escolha 1 palavra curta MAIÚSCULA relacionada ao tema (ex: REPO, LISTA, GUIA, KIT, PDF). A frase deve ser o encerramento do post, sem link real. Para thread: coloque no último tweet.`
              : '',
            formatInstruction,
          ].filter(Boolean).join('\n')

          const result = await generateSimpleText({
            model: ctx.dbConfig?.model ?? writerModel,
            systemPrompt,
            userMessage,
            maxTokens: 1500,
            temperature: ctx.dbConfig?.temperature ?? 0.8,
          })

          tokensUsed += result.tokensUsed

          // Parse AI response
          let parsed: { content: string | string[]; format: string }
          try {
            parsed = parseAIJson(result.text, `writer item: ${item.id} platform: ${platformConfig.platform}`)
          } catch (err) {
            errors.push(`Parse error for ${item.id}/${platformConfig.platform}: ${err instanceof Error ? err.message : 'unknown'}`)
            continue
          }

          // For reel/carousel format, content is JSON — skip length truncation
          const isReelFormat = parsed.format === 'reel'
          const isCarouselFormat = parsed.format === 'carousel'
          const isThread = parsed.format === 'thread' && Array.isArray(parsed.content)

          // Validate content length
          let contentText: string
          if (isThread) {
            // Preserve array as JSON string so publisher can reconstruct the thread
            const tweets = (parsed.content as string[]).filter(t => t && t.trim().length > 0)
            if (tweets.length < 2) {
              errors.push(`Thread too short (${tweets.length} tweets) for item ${item.id}/${platformConfig.platform}`)
              continue
            }
            contentText = JSON.stringify(tweets)
          } else if (isReelFormat || isCarouselFormat || parsed.content == null) {
            // Reel/carousel/structured JSON (e.g. Brand feed post: headline/context/kpi)
            // has no 'content' field — store full raw JSON so publisher can parse it
            contentText = result.text
          } else {
            contentText = typeof parsed.content === 'string'
              ? parsed.content
              : JSON.stringify(parsed.content)
            // Never truncate — incomplete content scores low with the reviewer.
            // Reject and let the writer try a shorter angle on the next run.
            if (contentText.length > platformConfig.maxLength) {
              errors.push(`Content too long (${contentText.length}/${platformConfig.maxLength} chars) for item ${item.id}/${platformConfig.platform} — skipped, not truncated`)
              continue
            }
          }

          // Skip rejected content (out-of-scope — writer returns format: "rejected")
          if (parsed.format === 'rejected') {
            errors.push(`Rejected (out of scope) for curated item ${item.id}/${platformConfig.platform}`)
            aiRejectionsForThisItem++
            continue
          }

          if (!contentText || contentText.trim().length === 0) {
            errors.push(`Empty content generated for curated item ${item.id}/${platformConfig.platform}`)
            continue
          }

          // Safety net: strip external links from X posts before storing.
          // Guards against hallucinated URLs — the model rarely generates them (source
          // text is pre-stripped) but this prevents any that slip through from reaching
          // the publisher and triggering X's off-platform traffic penalty.
          if (isXPlatform) {
            if (isThread) {
              const tweets = JSON.parse(contentText) as string[]
              contentText = JSON.stringify(tweets.map(t => stripExternalLinksForX(t)))
            } else if (!isReelFormat && !isCarouselFormat) {
              contentText = stripExternalLinksForX(contentText)
            }
          }

          // Insert into generated_content
          const isBreakingNews = !!(item.score_breakdown?.breaking_news)
          const { error: insertError } = await supabase.from('generated_content').insert({
            workspace_id: ctx.workspaceId,
            curated_content_id: item.id,
            target_platform: platformConfig.platform,
            target_format: isReelFormat ? 'reel' : isCarouselFormat ? 'carousel' : (parsed.format ?? 'post'),
            content: contentText,
            status: 'draft',
            model_used: ctx.dbConfig?.model ?? writerModel,
            pipeline_run_id: ctx.pipelineRunId ?? null,
            metadata: { breaking_news: isBreakingNews },
          })

          if (insertError) {
            errors.push(`Failed to save draft for curated item ${item.id}/${platformConfig.platform}: ${insertError.message}`)
            continue
          }

          draftsForThisItem++
          draftsCreated.push({
            curatedId: item.id,
            platform: platformConfig.platform,
            title: item.source_content.slice(0, 50),
            content: contentText,
            format: parsed.format,
          })

          // ── A/B TESTING: Generate variant B with different hook ──
          // Skipped for reel/carousel/structured JSON (Brand feed_post etc.) —
          // those formats have no top-level "content" field, so variantParsed.content
          // is always undefined here. JSON.stringify(undefined) returns the value
          // undefined (not a string), and variantContent.trim() below throws —
          // silently swallowed by the catch, wasting a full LLM call (maxTokens:
          // 1500) on every draft with nothing ever inserted.
          if (!isReelFormat && !isCarouselFormat && parsed.content != null && (Date.now() - startTime) < MAX_EXECUTION_MS) {
            try {
              const variantPrompt = userMessage + '\n\nIMPORTANTE: Esta e a VARIANTE B. Use um HOOK COMPLETAMENTE DIFERENTE da versao anterior. Mude o angulo, use outro pattern da biblioteca de hooks. O conteudo pode ser similar mas a abertura DEVE ser diferente.'
              const variantResult = await generateSimpleText({
                model: ctx.dbConfig?.model ?? this.config.defaultModel,
                systemPrompt,
                userMessage: variantPrompt,
                maxTokens: 1500,
                temperature: 0.9, // Higher temp for more variation
              })
              tokensUsed += variantResult.tokensUsed

              const variantParsed = parseAIJson(variantResult.text, `variant-B ${item.id}/${platformConfig.platform}`) as { content: string | object; format?: string }

              // Thread format: content is an array of tweets. Its JSON.stringify()
              // routinely exceeds platformConfig.maxLength (280 = one tweet's limit,
              // not the whole thread's) — never slice() it, that corrupts the JSON
              // mid-string/mid-array and the publisher permanently rejects it as
              // MalformedThread. Mirrors the main draft's isThread handling above.
              const variantIsThread = variantParsed.format === 'thread' && Array.isArray(variantParsed.content)
              const variantContent = variantIsThread
                ? JSON.stringify((variantParsed.content as string[]).filter(t => t && t.trim().length > 0))
                : (typeof variantParsed.content === 'string' ? variantParsed.content : JSON.stringify(variantParsed.content))

              // Never truncate non-thread content either — same policy as the main
              // draft path: reject and let the writer try a shorter angle next run.
              const variantTooLong = !variantIsThread && variantContent.length > platformConfig.maxLength

              if (variantParsed.format !== 'rejected' && variantContent.trim() && variantContent !== contentText && !variantTooLong) {
                await supabase.from('generated_content').insert({
                  workspace_id: ctx.workspaceId,
                  curated_content_id: item.id,
                  target_platform: platformConfig.platform,
                  target_format: variantParsed.format ?? platformConfig.platform,
                  content: variantContent,
                  status: 'draft',
                  model_used: ctx.dbConfig?.model ?? this.config.defaultModel,
                  pipeline_run_id: ctx.pipelineRunId ?? null,
                  metadata: { variant: 'B', breaking_news: isBreakingNews },
                })
                draftsForThisItem++
                draftsCreated.push({
                  curatedId: item.id,
                  platform: platformConfig.platform,
                  title: `[B] ${item.source_content.slice(0, 45)}`,
                  content: variantContent,
                  format: variantParsed.format ?? platformConfig.platform,
                })
              }
            } catch {
              // Variant B generation is best-effort — don't fail the whole item
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          errors.push(`Error processing curated item ${item.id}/${platformConfig.platform}: ${message}`)
        }
      }

      // Update curated_content status
      if (draftsForThisItem > 0 && !isArchivedVideoItem) {
        // Don't downgrade already-'written' archived items — their status stays as-is
        await supabase.from('curated_content').update({ status: 'written' }).eq('id', item.id)
      } else if (aiRejectionsForThisItem > 0 && draftsForThisItem === 0 && !isArchivedVideoItem) {
        // All non-skipped platforms returned format:'rejected' — item is out of scope.
        // Don't reject archived items — they may still be useful for other runs.
        await supabase.from('curated_content').update({ status: 'rejected' }).eq('id', item.id)
      }
    }

    return {
      success: draftsCreated.length > 0 || errors.length === 0,
      itemsProcessed: itemsToProcess.length,
      itemsProduced: draftsCreated.length,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.0000003,
      durationMs: Date.now() - startTime,
      details: {
        draftsCreated: draftsCreated.length,
        skippedDuplicates,
        platformsUsed: Array.from(new Set(draftsCreated.map(d => d.platform))),
        drafts: draftsCreated.map(d => ({
          platform: d.platform,
          title: d.title,
          format: d.format,
          content: d.content,
        })),
        failedItems: errors.length,
      },
    }
  }

  private buildBlogSystemPrompt(brief: Record<string, unknown>, keyword: string): string {
    const secondaryKws = (brief.secondary_keywords as string[] | undefined) ?? []
    const headings = (brief.headings as { h1?: string; h2s?: string[]; h3s?: Record<string, string[]> } | undefined) ?? {}
    const geoAngle = (brief.geo_angle as string | undefined) ?? ''
    const eeatTips = (brief.eeat_tips as string[] | undefined) ?? []
    const intent = (brief.intent as string | undefined) ?? 'informacional'
    const serpFeature = (brief.serp_feature as string | undefined) ?? ''
    const titleTag = (brief.title_tag as string | undefined) ?? keyword

    return [
      `Voce e um redator de conteudo SEO senior especializado em tech e inteligencia artificial em portugues brasileiro.`,
      `Escreve artigos de blog otimizados para Google e AI Overviews (GEO).`,
      ``,
      `## BRIEF DO ARTIGO`,
      `Keyword principal: "${keyword}"`,
      `Intencao de busca: ${intent}`,
      `SERP feature alvo: ${serpFeature}`,
      `Title tag: ${titleTag}`,
      secondaryKws.length ? `Keywords secundarias (use naturalmente): ${secondaryKws.join(', ')}` : '',
      ``,
      headings.h1 ? `## ESTRUTURA SUGERIDA\nH1: ${headings.h1}` : '',
      headings.h2s?.length ? `H2s: ${headings.h2s.join(' | ')}` : '',
      ``,
      geoAngle ? `## ANGULO GEO (para AI Overviews)\n${geoAngle}` : '',
      ``,
      eeatTips.length ? `## E-E-A-T\n${eeatTips.map(t => `- ${t}`).join('\n')}` : '',
      ``,
      `## REGRAS DE ESCRITA`,
      `- Primeiro paragrafo: resposta direta (134-167 palavras) — responde a intent principal sem rodeios`,
      `- Dados especificos: numeros, porcentagens, datas — IAs preferem conteudo factual`,
      `- Estrutura citavel: headers claros H2/H3, listas numeradas, tabelas comparativas`,
      `- Tom: tecnico mas acessivel para dev/tech audience brasileira`,
      `- Zero plagiagio — conteudo original, perspectiva propria`,
      `- Use as keywords secundarias de forma natural — nunca stuffing`,
      `- Termine com uma secao de FAQ se o SERP feature alvo for people_also_ask`,
    ].filter(Boolean).join('\n')
  }

  private buildPlatformPrompt(config: PlatformConfig, ctx: RunContext, features: WorkspaceFeatures): string {
    const maxLength = config.maxLength

    // ── BRAND IDENTITY & CONTENT SCOPE ──
    const lines = [
      `## IDENTIDADE DA MARCA`,
      `Voce publica para @example_handle no Twitter/X e @your_brand no Instagram.`,
      `Tom: engenheiro senior brasileiro que testa IA em producao e compartilha descobertas reais.`,
      '',
      `## ESCOPO DE CONTEUDO (INVIOLAVEL)`,
      `SOMENTE gere conteudo sobre: Inteligencia Artificial, Machine Learning, LLMs, AI Agents, DevTools, AI Research, AI Safety, Automacao com IA, Coding com IA.`,
      `NUNCA gere conteudo sobre: crypto, DeFi, blockchain, tokens, NFTs, trading, forex, mineracao, carteiras digitais, airdrops.`,
      `Se o conteudo fonte e sobre crypto/finance e NAO sobre IA, retorne: {"content": "", "format": "rejected"}`,
      '',
      `FORMATO DE RESPOSTA: Retorne APENAS JSON valido: {"content": "texto", "format": "plataforma"}`,
      '',

      // ── VOICE & PERSONA ──
      `Voce e um copywriter tech brasileiro de elite. Seu estilo combina profundidade tecnica com clareza brutal.`,
      `Voce NAO e um assistente de IA. Voce e um engenheiro senior que testa IA em producao e compartilha descobertas reais.`,
      '',
      `PERSONA: Pragmatico, data-driven, sem hype. Usa termos tecnicos em ingles naturalmente quando faz sentido.`,
      `REFERENCIAS DE TOM: @rowancheung (novidades acessiveis de IA), @minchoi (dicas praticas de IA), @TheAIGRID (impacto real da IA), @karpathy (profundidade tecnica quando necessario)`,
      '',
      `## AUDIENCIA-ALVO (INVIOLAVEL)`,
      `Escreva para alguem que usa ChatGPT e conhece o nome Gemini, Claude, Perplexity — mas NUNCA ouviu falar de RAG, LoRA, RLHF, fine-tuning, embedding, quantization, benchmark, arxiv, vLLM, LangChain.`,
      `REGRA: Se o conteudo fonte usa jargao tecnico, TRADUZA para linguagem de todo dia antes de escrever.`,
      `  - "RAG" → "sistema que conecta a IA aos seus documentos"`,
      `  - "fine-tuning" → "treinamento especializado de uma IA"`,
      `  - "benchmark" → "teste de desempenho"`,
      `  - "token" → "palavra" (quando no contexto de custo/limite)`,
      `  - "embedding" → "como a IA entende o significado das palavras"`,
      `  - Nome de modelo/ferramenta obscuro → descreva o que ela FAZ, nao o nome`,
      `Se nao conseguir traduzir para linguagem simples, use a pergunta: "O que isso significa na pratica para quem usa IA no dia a dia?"`,
      '',
      `ATENCAO: Acessivel NAO significa vago. Seja ESPECIFICO na linguagem do publico geral:`,
      `  ❌ VAGO: "A IA esta ficando mais inteligente" (poderia ser qualquer coisa)`,
      `  ✅ ESPECIFICO: "O ChatGPT agora lembra tudo que voce disse nas ultimas conversas — sem voce precisar repetir"`,
      `  ❌ VAGO: "Nova ferramenta de IA muda tudo"`,
      `  ✅ ESPECIFICO: "A Perplexity lancou uma funcao que pesquisa a internet por voce e escreve o resumo em segundos"`,
      `A especificidade vem do EVENTO concreto (o que mudou, quem fez, o que o usuario consegue fazer agora).`,
      '',
      `FRASES PROIBIDAS (NUNCA use — soam como IA):`,
      `- "revolucionario", "game-changer", "o futuro e agora", "e impressionante"`,
      `- "nao e segredo que", "nao e nenhuma surpresa"`,
      `- "em um mundo onde", "na era da IA"`,
      `- "desbloquear o potencial", "transformar a maneira como"`,
      `- "mergulhar fundo", "vamos explorar"`,
      `- "sem mais delongas", "dito isso"`,
      `- "e importante notar que", "vale ressaltar"`,
      `- qualquer emoji no Twitter/X`,
      '',

      // ── COPYWRITING PRINCIPLES ──
      `## PRINCIPIOS DE COPYWRITING (aplique a CADA post)`,
      '',
      `### Clareza > Criatividade`,
      `- Se tiver que escolher entre claro e criativo, escolha CLARO`,
      `- Cada frase deve ter UM unico trabalho`,
      `- Remova palavras que nao adicionam significado`,
      '',
      `### Especificidade > Generalidade`,
      `- RUIM: "Economize tempo no seu workflow"`,
      `- BOM: "Corte seu relatorio semanal de 4 horas para 15 minutos" (SO SE esses numeros estiverem na fonte)`,
      `- Use numeros concretos e metricas reais — MAS SOMENTE os que estiverem EXPLICITAMENTE na fonte. Se a fonte nao tem numero, nao invente.`,
      '',
      `### Linguagem do Publico > Linguagem Corporativa`,
      `- Use as palavras que devs e tech leaders realmente usam`,
      `- Evite jargao corporativo: "solucao", "alavancagem", "sinergia"`,
      `- Termos tecnicos em ingles sao naturais: "deploy", "pipeline", "benchmark"`,
      '',
      `### Voz Ativa > Passiva`,
      `- BOM: "O Claude processa 1M tokens em 12s"`,
      `- RUIM: "1M tokens sao processados em 12s pelo Claude"`,
      '',
      `### Mostrar > Contar`,
      `- NAO diga "facilmente" — MOSTRE como e facil`,
      `- NAO diga "rapido" — MOSTRE o tempo exato`,
      `- NAO diga "poderoso" — MOSTRE o que ele FAZ`,
      '',
      `### Perguntas Retoricas (use com moderacao)`,
      `- Engajam o leitor e fazem pensar na propria situacao`,
      `- "Voce sabe por que 80% dos RAGs falham em producao?"`,
      `- "Quanto tempo voce perde debugando prompts?"`,
      '',
      `### Analogias e Metaforas (quando apropriado)`,
      `- Tornam conceitos abstratos concretos`,
      `- "Fine-tuning e como ensinar um chef a cozinhar um prato especifico — caro e demorado. Few-shot e como dar uma receita — rapido e barato."`,
      '',
      `### Uma Ideia Por Post`,
      `- Nao tente dizer tudo em um post`,
      `- Cada post avanca UM argumento`,
      `- Se tem 2 ideias, faca 2 posts`,
      '',

      // ── CONTENT DENSITY RULES ──
      `## REGRA ABSOLUTA — FIDELIDADE AO CONTEUDO FONTE (NAO NEGOCIAVEL):`,
      `Voce SO pode afirmar fatos, numeros, nomes de modelos, versoes, benchmarks e estatisticas que estejam EXPLICITAMENTE escritos no conteudo fonte.`,
      `NUNCA invente ou adicione: nomes de modelos (ex: "Claude 3.5 Sonnet", "GPT-4.5"), versoes, porcentagens, rankings ou comparacoes que NAO estejam na fonte.`,
      `Se a fonte nao menciona um modelo especifico — voce NAO menciona nenhum. Se a fonte nao tem numero — voce NAO coloca numero.`,
      `A criatividade fica no hook, angulo e estrutura narrativa. Os FATOS vem EXCLUSIVAMENTE da fonte.`,
      `Violar esta regra e pior do que um post fraco — e desinformacao.`,
      '',
      `## REGRAS DE DENSIDADE (aplique a CADA post):`,
      `- OBRIGATORIO: cada post deve conter pelo menos UM de: numero/benchmark especifico, entidade nomeada (empresa/paper/produto), comparacao (X vs Y), exemplo concreto`,
      `- Se o conteudo fonte NAO tiver nenhum desses elementos, use apenas o que esta disponivel — NAO invente para cumprir a regra`,
      `- PROIBIDO: frases que nao adicionam fato, insight ou opiniao. Se uma frase pode ser removida sem perder informacao, REMOVA.`,
      `- PROIBIDO: abrir com "Voce sabia que..." ou "Ja pensou em..."`,
      `- PREFERENCIA: dados > opiniao > generalizacao. Sempre que possivel, inclua a fonte.`,
      `- Escaneabilidade: O leitor deve entender o ponto principal em 3 segundos`,
      `- Sem exclamacoes: Remova pontos de exclamacao — eles enfraquecem a mensagem`,
      `- Sem buzzwords vazios: "inovador", "disruptivo", "cutting-edge" sao proibidos a menos que acompanhados de PROVA`,
      '',

      // ── HOOK PATTERNS LIBRARY ──
      `## BIBLIOTECA DE HOOKS (use UM para cada post):`,
      `AVISO: Os exemplos abaixo sao FICTICIOS para ilustrar o ESTILO. Nunca copie os numeros/fatos dos exemplos — use APENAS dados da fonte.`,
      `1. STAT SHOCK: Abrir com numero da fonte ("A [empresa X] atingiu Y tokens/s. Isso muda [o que a fonte diz].")`,
      `2. CONTRARIAN: Desafiar sabedoria convencional com argumento da fonte ("Todo mundo fala de X, mas a fonte mostra Y...")`,
      `3. FUTURE CAST: Previsao baseada no que a fonte afirma, nao inventada ("Se [dado da fonte] continuar, [inferencia logica].")`,
      `4. INSIDER: Enquadrar como insider o que a fonte revelou ("O que a maioria nao percebeu no anuncio de [empresa da fonte]:")`,
      `5. DIRECT Q: Pergunta que a fonte responde ("Por que [empresa da fonte] fez [acao da fonte]?")`,
      `6. HOT TAKE: Opiniao baseada em dado da fonte ("Com [metrica da fonte], [posicao clara].")`,
      `7. BEFORE/AFTER: SO se a fonte tiver numeros comparativos ("Antes: [dado old]. Depois: [dado new]. Fonte: [quem publicou].")`,
      `8. MYTH BUST: Corrigir misconception com dado da fonte ("Mito: X. Realidade segundo [fonte]: Y.")`,
      `9. THREAD HOOK: Listar APENAS o que a fonte menciona — nunca inventar itens para completar lista`,
      `10. DATA DROP: Iniciar com dado bruto DA FONTE com atribuicao ("Segundo [autor/empresa]: [dado exato].")`,
      '',
    ]

    // ── PLATFORM-SPECIFIC FRAMEWORKS ──
    if (config.platform === 'x' || config.platform === 'twitter') {
      lines.push(
        `## FRAMEWORK: Hook-Insight-CTA (Twitter/X)`,
        `ESTRUTURA OBRIGATORIA:`,
        `1. HOOK (1 frase): Use um pattern da biblioteca acima. DEVE parar o scroll.`,
        `2. INSIGHT (1-2 frases): Dado concreto, comparacao, ou perspectiva unica.`,
        `3. CTA implito: Termine com algo que convide reacao (pergunta retorica, provocacao, ou dado que surpreende).`,
        '',
        `FORMATO: 180-260 caracteres ideais. Maximo ${maxLength}. SEM paragrafos, SEM quebras de linha, SEM hashtags, SEM emojis.`,
        `Tom: direto, tecnico, conversacional. Como um tweet de @karpathy, nao um press release.`,
        '',
        `REGRAS X/TWITTER (TOLERANCIA ZERO):`,
        `- ZERO emojis (qualquer emoji = rejeicao pelo Revisor)`,
        `- ZERO hashtags (qualquer hashtag = rejeicao pelo Revisor)`,
        `- ZERO pontos de exclamacao`,
        `- NUNCA inclua links externos (instagram.com, youtube.com, linkedin.com, qualquer dominio fora do X) — o algoritmo do X penaliza posts que tiram trafego da plataforma. Links internos (x.com/... ou t.co/...) sao permitidos, nunca para revelar a fonte curada.`,
        `- O post deve parecer 100% original e nativo do X.`,
        '',
        `## FORMATO DE SAIDA — ESCOLHA UM:`,
        '',
        `OPCAO A — Tweet unico (conteudo simples, 1 ideia clara):`,
        `{"content": "texto do tweet aqui (max ${maxLength} chars)", "format": "x"}`,
        '',
        `OPCAO B — Thread (conteudo rico com 3+ pontos distintos, dados, listas, historias):`,
        `{"content": ["Tweet 1 — HOOK que para o scroll (max 260 chars)", "Tweet 2 — ponto 1 com dado concreto", "Tweet 3 — ponto 2 com exemplo", "Tweet 4 — insight ou conclusao"], "format": "thread"}`,
        '',
        `REGRAS DO THREAD:`,
        `- Minimo 3 tweets, maximo 6`,
        `- Cada tweet max ${maxLength} chars`,
        `- Tweet 1 deve funcionar sozinho como hook — o leitor deve querer continuar`,
        `- Cada tweet = 1 ideia completa, nao fragmentos de frases`,
        `- NUNCA numere os tweets manualmente (sem "1/4", "2/4" etc)`,
        `- Use thread quando: lista de fatos, comparacao X vs Y, historia com desenvolvimento, analise com multiplos dados`,
      )
    } else if (config.platform === 'linkedin') {
      lines.push(
        `## FRAMEWORK: Hook-Story-Lesson (LinkedIn)`,
        `ESTRUTURA OBRIGATORIA:`,
        `1. HOOK (1 linha): Afirmacao ousada que faz o leitor parar. Linha unica, sem ponto final (gera curiosidade).`,
        `2. (linha em branco)`,
        `3. CONTEXTO (3-5 bullet points): Dados, exemplos, ou historia curta. Cada bullet = 1 fato novo.`,
        `4. (linha em branco)`,
        `5. TAKEAWAY + PERGUNTA: Insight principal + pergunta que gera comentarios.`,
        '',
        `FORMATO: 800-1300 caracteres. Maximo ${maxLength}. Hashtags: 3-5 relevantes no final. Emojis: 1-2 estrategicos (inicio de bullets).`,
        `Tom: profissional mas acessivel. Insights de quem implementa, nao de quem teoriza.`,
      )
    } else if (config.platform === 'instagram') {
      lines.push(
        `## FRAMEWORK: Visual-First (Instagram)`,
        `ESTRUTURA: Caption que complementa a imagem, nao repete.`,
        `1. HOOK (1 linha): Gancho curto que funciona SEM a imagem.`,
        `2. CONTEXTO: Expandir o tema com dados.`,
        `3. CTA: Pergunta ou convite a acao.`,
        '',
        `VARIACAO DE ESTRUTURA (obrigatorio — evita fingerprint de bot):`,
        `- 40% dos posts: 2 paragrafos (hook + insight direto + CTA na mesma linha)`,
        `- 40% dos posts: 3 paragrafos (padrao: hook + contexto + CTA separado)`,
        `- 20% dos posts: 4 paragrafos (hook + contexto + dado extra + CTA)`,
        `CTA pode estar no FINAL ou no penultimo paragrafo como pergunta aberta.`,
        `NUNCA use a mesma abertura em posts consecutivos (varie: dado, pergunta, afirmacao bold).`,
        '',
        `PILAR DE CONTEUDO DESTA HORA (C3 — rotacao a cada 6h para diversidade editorial):`,
        `Pilar atual: ${['educativo', 'inspiracional', 'controversia', 'tendencia'][Math.floor(Date.now() / (6 * 60 * 60 * 1000)) % 4]}`,
        `- educativo: dado/conceito ensinavel, tom didatico, explica o "por que"`,
        `- inspiracional: caso de sucesso, transformacao, possibilidade`,
        `- controversia: opiniao forte, contra-narrativa, debate provocativo`,
        `- tendencia: novidade recente, o que esta mudando agora`,
        `Aplique a angulacao do pilar atual — nao mencione o pilar explicitamente.`,
        '',
        `FORMATO: Maximo ${maxLength}. Hashtags: 10-20 relevantes. Emojis: encorajados para scanability.`,
        '',
        `## ALTERNATIVA — Se target_format = "reel":`,
        '',
        `## FRAMEWORK: Open Loop (Reels)`,
        `REGRA CRITICA: Slide 1 cria uma TENSAO que so resolve no ultimo slide.`,
        `Exemplo: Slide 1 "O modelo que o Google tentou esconder" → Slide 5 "Gemini Ultra 2 — e por isso que eles esperaram"`,
        `Cada slide = 1 unica ideia. Se precisa explicar, precisa de outro slide.`,
        '',
        `Retorne JSON com estrutura de slides para Instagram Reel:`,
        '```json',
        '{',
        '  "format": "reel",',
        '  "slides": [',
        '    { "text": "HOOK: pergunta provocativa ou dado surpreendente", "duration": 3, "style": "bold-center" },',
        '    { "text": "INSIGHT: ponto principal com dado concreto", "duration": 3, "style": "stat-highlight" },',
        '    { "text": "DETALHE: contexto ou exemplo pratico", "duration": 3, "style": "body" },',
        '    { "text": "CTA: Siga @your_brand para mais", "duration": 3, "style": "cta" }',
        '  ],',
        '  "caption": "Caption completo com 10-20 hashtags relevantes...",',
        '  "image_prompts": [',
        '    "Prompt para imagem de fundo do slide 1 (estilo: futurista, dark, tech)",',
        '    "Prompt para imagem de fundo do slide 2",',
        '    "..."',
        '  ],',
        '  "total_duration": 12',
        '}',
        '```',
        '',
        '### Regras para Reels:',
        '- 3 a 5 slides, total 7-15 segundos',
        '- Slide 1 OBRIGATORIO: HOOK forte (pergunta, stat surpreendente, afirmacao bold)',
        '- Max 15 palavras por slide (legivel no celular)',
        '- Ultimo slide deve ter CTA (seguir, comentar, compartilhar)',
        '- Caption com 10-20 hashtags relevantes ao tema tech/IA',
        '- image_prompts: descricoes em ingles para AI image generation (estilo dark, futurista, minimal)',
        '- O ultimo slide deve conectar tematicamente ao primeiro (loop effect)',
      )
      // Optional EV B2B format guide. For other companies, use the workspace
      // system prompt to provide an equivalent company-specific editorial guide.
      if (features.ev_market_curation) {
        lines.push(
          '',
          '## IDIOMA OBRIGATÓRIO: Português Brasileiro (PT-BR)',
          'TODO conteúdo gerado para o @brand DEVE ser em Português Brasileiro, sem exceção.',
          'Mesmo que a fonte seja em inglês, escreva inteiramente em PT-BR.',
          'Termos técnicos internacionais (OCPP, EV, BEV, V2G, BESS, CCS2) podem ser mantidos — o restante em PT-BR.',
          '',
          '## CALIBRAÇÃO POR CATEGORIA (quando a mensagem contiver "CATEGORIA DETECTADA"):',
          'O curador classifica cada conteúdo em uma das categorias EV B2B abaixo.',
          'Quando presente no userMessage, ADAPTE o copy ao ângulo da categoria:',
          '- ev_technical → linguagem técnica, público: integradores e engenheiros de TI',
          '- ev_fleet     → foco em ROI/TCO/eficiência, público: gestores de frota',
          '- ev_infrastructure → caso de negócio para imóvel (condomínio, shopping, posto)',
          '- ev_regulatory → vantagem regulatória, compliance, first-mover advantage',
          '- ev_market_br → contexto Brasil, dados nacionais, tom PT-BR próximo',
          '- ev_launch    → novidade/specs com impacto para frotas B2B',
          '- ev_news      → EV B2B geral — público empresarial brasileiro',
          '- seasonal     → data comemorativa institucional, tom humano/emocional (ver ângulo editorial na fonte)',
          '',
          '## EXCEÇÃO QUE ANULA O FRAMEWORK ABAIXO: se a FONTE contiver "RESTRIÇÃO OBRIGATÓRIA" proibindo CTA comercial',
          '(ex.: datas de luto/homenagem), a "ESTRUTURA OBRIGATÓRIA" dos frameworks de carousel/feed_post NÃO se aplica',
          'ao CTA/Slide 5: substitua por encerramento sóbrio, sem venda, sem "your-company.example", sem convite de contato,',
          'sem @brand promocional. O restante da estrutura (headline/kpi/dados) segue normal.',
          '',
          '## ALTERNATIVA — Se target_format = "carousel":',
          '',
          '## FRAMEWORK: Carrossel de Vendas Brand (5 slides)',
          'OBJETIVO: Cada carrossel = mini-funil de vendas. Slide 1 para o scroll. Slide 5 converte.',
          '',
          'A Brand oferece: venda de eletropostos, instalação e consultoria EV para empresas.',
          'Público-alvo: gestores de frota, incorporadoras/condomínios, postos de combustível, prefeituras.',
          'REGRA DE FIDELIDADE: use SOMENTE dados e fatos presentes na fonte. Nunca invente números, ROI ou benchmarks.',
          '',
          'ESTRUTURA OBRIGATÓRIA (5 slides):',
          'Slide 1 — COVER: fato ou dado impactante do setor EV presente na fonte + KPI',
          'Slide 2 — PROBLEMA: desafio real que empresas enfrentam sem infra EV (baseado na fonte)',
          'Slide 3 — SOLUÇÃO: o que a Brand resolve — nomear o serviço',
          'Slide 4 — PROVA: dado de mercado ou contexto presente na fonte',
          'Slide 5 — CTA: chamada para ação + your-company.example',
          '',
          'REGRAS:',
          '- headline de cada slide: máx 6 palavras, MAIÚSCULAS',
          '- body: 1-2 frases curtas e diretas',
          '- kpi: obrigatório nos slides 1, 3 e 4 (somente se existir número na fonte)',
          '- image_prompt por slide: prompt DIFERENTE por background (inglês, 100-200 chars, dark EV aesthetic)',
          '  • Slides 1-2: cena do problema/contexto do setor',
          '  • Slide 3: solução em ação (eletroposto instalado, infra corporativa)',
          '  • Slide 4: resultado ou panorama do mercado',
          '  • Slide 5: fundo escuro minimalista (deep blacks, subtle violet gradient, no objects)',
          '- caption: legenda de venda com hook na primeira linha + CTA "👉 your-company.example" + 8-12 hashtags EV',
          '',
          'Retorne JSON:',
          '```json',
          '{',
          '  "format": "carousel",',
          '  "imagePrompt": "base visual prompt",',
          '  "slides": [',
          '    { "type": "cover", "headline": "DADO IMPACTANTE", "kpi": "métrica", "image_prompt": "..." },',
          '    { "type": "content", "headline": "O PROBLEMA HOJE", "body": "frase do problema.", "image_prompt": "..." },',
          '    { "type": "content", "headline": "YOUR BRAND RESOLVE", "body": "serviço específico.", "kpi": "resultado", "image_prompt": "..." },',
          '    { "type": "content", "headline": "PROVA DO MERCADO", "body": "dado ou contexto.", "kpi": "métrica", "image_prompt": "..." },',
          '    { "type": "cta", "headline": "FALE COM ESPECIALISTA", "body": "Do projeto à instalação. your-company.example", "image_prompt": "dark minimal, deep blacks, subtle violet gradient, no text no objects" }',
          '  ],',
          '  "caption": "hook na primeira linha (máx 100 chars)\\n\\ncontexto + dado + relevância para público-alvo\\n\\nSua empresa precisa de infra EV? A Brand resolve. 👉 your-company.example\\n\\n@brand\\n\\n#eletroposto #EVBrasil #mobilidadeeletrica #frota #infraestruturaEV #brand"',
          '}',
          '```',
          '',
          '## ALTERNATIVA — Se target_format = "feed_post":',
          '',
          '## FRAMEWORK: Post de Venda Brand',
          'Retorne JSON:',
          '```json',
          '{',
          '  "format": "feed_post",',
          '  "headline": "FRASE IMPACTO MÁXIMO (máx 5 palavras)",',
          '  "context": "1-2 frases de contexto com dado da fonte. Este texto é renderizado como bloco na imagem — NUNCA um parágrafo inteiro.",',
          '  "kpi": "métrica impactante (somente se existir número na fonte). Se a fonte não trouxer nenhuma métrica pública, OMITA este campo — nunca preencha com score/prioridade/ângulo/selo do pipeline interno.",',
          '  "image_prompt": "prompt cinematográfico dark EV B2B 9:16 (inglês, 100-200 chars)",',
          '  "caption": "hook na primeira linha (máx 100 chars)\\n\\ncontexto + dado + público-alvo\\n\\nCTA 👉 your-company.example\\n\\n@brand\\n\\n#eletroposto #EVBrasil #mobilidadeeletrica"',
          '}',
          '```',
          'NUNCA copie campos de metadado interno (score, prioridade editorial, ângulo, selo, launch_score) para "context" ou "kpi" — esses campos existem só para você julgar relevância, não são conteúdo publicável.',
        )
      }
    } else {
      // Fallback for other platforms
      lines.push(
        `## Estilo desta plataforma:`,
        config.styleGuide,
        '',
        `## Limites:`,
        `- Maximo ${maxLength} caracteres`,
        config.allowHashtags ? `- ${config.maxHashtags} hashtags permitidas` : '- ZERO hashtags',
        config.allowEmojis ? '- Emojis permitidos' : '- ZERO emojis',
        config.requireImage ? '- OBRIGATORIO: este post precisa de imagem' : '',
      )
    }

    // ── RESPONSE FORMAT ──
    lines.push(
      '',
      '## Formato de resposta (CRITICO):',
      `Sua resposta deve conter APENAS o JSON abaixo — sem texto antes, sem explicacao, sem markdown:`,
      `{"content": "<texto do post, max ${maxLength} chars>", "format": "${config.platform}"}`,
      `Se o conteudo fonte nao for sobre IA/tech, retorne: {"content": "", "format": "rejected"}`,
      `NUNCA inclua nada fora do JSON. A primeira linha da resposta deve ser "{" e a ultima "}".`,
    )

    // ── PERMANENT GUARDRAILS — erros recorrentes codificados permanentemente ──
    // Estes padrões foram identificados como erros sistemáticos (60+ dias de evals).
    // Ao contrário do feedbackContext (que decai em 14 dias), estas regras são imutáveis.
    lines.push(
      '',
      '## GUARDRAILS PERMANENTES (erros históricos recorrentes — nunca ignore):',
      '',
      '### 1. TAMANHO — erro mais frequente (310 ocorrências: 137 "muito curto" + 173 size dimension 1-3/10)',
      'Posts muito curtos são o problema #1 absoluto — afeta 310 avaliações nos últimos 60 dias.',
      `- X/Twitter: mínimo 180 chars. Se ficou abaixo de 150, reescreva com mais contexto.`,
      `- Instagram: varie entre 2, 3 ou 4 parágrafos (ver framework Visual-First). Nunca uma frase solta.`,
      `- ❌ CURTO DEMAIS: "A OpenAI lançou o GPT-5. Vale a pena testar." (informação, sem contexto ou implicação)`,
      `- ✅ SUBSTÂNCIA: "A OpenAI lançou o GPT-5. [O que a fonte diz que ele faz diferente.] O que isso muda na prática: [implicação direta da fonte]."`,
      `- Se o conteúdo fonte é escasso, desenvolva o CONTEXTO e a IMPLICAÇÃO — sem inventar fatos.`,
      '',
      '### 2. DADOS CONCRETOS — erro #2 (107 ocorrências)',
      'Posts vagos sem dado específico são sistematicamente rejeitados.',
      `- Sempre ancore em: nome de empresa/produto, ação específica, ou consequência concreta.`,
      `- ❌ "A IA está avançando muito" → ✅ "A OpenAI acabou de lançar [o que a fonte diz]"`,
      `- Se a fonte não tem número, use o EVENTO concreto: quem fez o quê.`,
      '',
      '### 3. VOZ — erro #3 (361 ocorrências: voice dimension 2-6/10 combinados)',
      `Tom "de bot" é o erro mais volumoso — 361 avaliações afetadas nos últimos 60 dias. Sinais de voz fraca:`,
      `- Frases que começam com "A IA", "O modelo", "Esta ferramenta" sem sujeito humano`,
      `- Conclusões óbvias: "isso vai mudar o mercado", "é uma revolução", "o futuro chegou"`,
      `- ❌ VOZ FRACA: "Esta ferramenta de IA é capaz de processar documentos de forma eficiente e precisa." (press release)`,
      `- ✅ VOZ FORTE: "Passei 2 horas ontem testando o [nome da fonte]. [O que a fonte diz que aconteceu de concreto]." (experiência real)`,
      `- Escreva como alguém que VIU isso acontecer, não como quem leu um press release.`,
      '',
      '### 4. GANCHO — erro #4 (111 + 73 ocorrências)',
      `Hook mediocre (6/10) é tão prejudicial quanto hook fraco — ambos são erros sistemáticos.`,
      `- Não comece com contexto ou backstory. Comece com o que SURPREENDE.`,
      `- Teste: se alguém ler só a primeira frase, vai querer continuar? Se não → reescreva o hook.`,
      `- ❌ MEDIOCRE: "A OpenAI anunciou uma nova versão do ChatGPT" (informativo, não para o scroll)`,
      `- ✅ FORTE: "O ChatGPT agora faz X — o que a maioria não percebeu no anúncio" (cria curiosidade imediata)`,
      `- Se o hook não gera TENSÃO ou CURIOSIDADE, troque de pattern na biblioteca de hooks.`,
      '',
      '### 5. CONTEÚDO INCOMPLETO — erro #5 (52 ocorrências)',
      `Posts que prometem no hook mas não entregam no corpo.`,
      `- O hook cria expectativa. O corpo DEVE cumprir. Sem exceção.`,
      `- ❌ INCOMPLETO: Hook "O que ninguém te contou sobre o novo modelo da Anthropic" → corpo de 1 frase vaga.`,
      `- ✅ COMPLETO: Hook cria tensão → corpo resolve com dado concreto da fonte → CTA fecha o raciocínio.`,
      `- Se não tem conteúdo suficiente na fonte para cumprir a promessa → mude o hook, não improvise.`,
      '',
      '### 6. DADOS ESPECÍFICOS — erro #6 (79 ocorrências)',
      `Diferente de "dados concretos": ter UM dado não basta — o dado precisa ser ESPECÍFICO o suficiente para ser útil.`,
      `- ❌ CONCRETO MAS VAGO: "A Anthropic lançou um modelo mais rápido" (empresa nomeada, mas nada específico)`,
      `- ✅ ESPECÍFICO: "A Anthropic lançou o Claude [nome da fonte] — [o que a fonte diz que ele faz de diferente]"`,
      `- Especificidade mínima aceitável: quem fez + o quê exato + qual a consequência prática para o usuário.`,
      `- Se a fonte é escassa em detalhes, use o formato: "[Empresa] fez [ação] — o que isso significa: [implicação direta]"`,
      '',
      '### 7. CONTEÚDO POLÍTICO — erro #7 (45 ocorrências, avg_score 5.0)',
      `Conteúdo político-partidário vaza mesmo quando a fonte mistura IA + política. Regra absoluta:`,
      `- NUNCA publique opinião sobre partidos, políticos, eleições, governo ou regulação com viés político.`,
      `- Se a fonte é sobre "o governo X regulando IA" ou "político Y usando IA": extraia SOMENTE o fato técnico de IA.`,
      `- ❌ PROIBIDO: "O governo [partido] quer regular a IA para [implicação política]"`,
      `- ✅ PERMITIDO: "A [país/região] propôs regulação de IA que exige [requisito técnico específico]"`,
      `- Se não for possível extrair fato técnico de IA sem o contexto político → retorne format: "rejected"`,
    )

    // ── BRAND & FEEDBACK CONTEXT ──
    if (ctx.brandContext) lines.push('', '## Marca:', ctx.brandContext)
    if (ctx.feedbackContext) lines.push('', '## Feedback recente (últimos 14 dias):', ctx.feedbackContext)

    return lines.filter(Boolean).join('\n')
  }

  private async getTopPerformingExamples(workspaceId: string, platform: string): Promise<string> {
    const supabase = getAdminClient()
    const isInstagram = platform === 'instagram'

    // Instagram: rankear por REACH real (engajamento), não review_score — que reflete a
    // qualidade da legenda (desconexa do alcance) e foi clobberado nos reels (~2.24).
    const base = supabase
      .from('generated_content')
      .select('content, reach, review_score')
      .eq('workspace_id', workspaceId)
      .eq('target_platform', platform)
      .eq('status', 'published')

    const { data } = isInstagram
      ? await base.not('reach', 'is', null).order('reach', { ascending: false }).limit(3)
      : await base.gte('review_score', 8).order('review_score', { ascending: false }).limit(3)

    // Escape example content so markdown headers/fences/dividers don't break prompt structure
    const escapeForPrompt = (text: string) =>
      text
        .replace(/^(#{1,6})\s/gm, '$1\u200B ') // zero-width space after # to neutralize headings
        .replace(/^---+$/gm, '\u2014\u2014\u2014') // replace --- dividers with em-dashes
        .replace(/^```/gm, '\u2019\u2019\u2019')   // replace ``` fences with curly quotes

    let out = ''
    if (data?.length) {
      const examples = (data as Array<{ content: string; reach: number | null; review_score: number | null }>).map((d, i) => {
        const label = isInstagram && d.reach != null ? `alcançou ${d.reach.toLocaleString('pt-BR')}` : `score ${d.review_score}/10`
        return `[EXEMPLO ${i + 1} | ${label}]\n${escapeForPrompt(d.content)}`
      }).join('\n\n')
      out = `\n## EXEMPLOS DE POSTS QUE PERFORMARAM BEM (use como referencia de tom, densidade e qualidade — NAO copie):\n${examples}`
    }

    // Instagram: anexar os padrões de gancho que de fato deram reach (retenção → alcance).
    if (isInstagram) {
      const insights = await buildEngagementInsights(workspaceId)
      if (insights) out += `\n\n${insights}`
    }

    return out
  }

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const draftsCreated = (d.draftsCreated as number) ?? 0
    const failedItems = (d.failedItems as number) ?? 0
    const total = result.itemsProcessed || 1

    const successRate = draftsCreated / total
    const autoScore = Math.round(successRate * 10)

    return {
      agentSlug: 'writer',
      inputSummary: `${result.itemsProcessed} curated items`,
      outputSummary: `${draftsCreated} drafts created, ${failedItems} failed`,
      autoScore: Math.max(1, Math.min(10, autoScore)),
      dimensions: {
        generation: successRate >= 0.8 ? 9 : successRate >= 0.5 ? 6 : 3,
        consistency: failedItems === 0 ? 10 : failedItems <= 2 ? 7 : 4,
      },
      issues: result.errors,
      verdict: successRate >= 0.7 ? 'keep' : successRate >= 0.4 ? 'improve' : 'reject',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>
    if (!result.success) {
      return `\u274C *Redator* \u2014 Erro: ${result.errors[0]}`
    }

    const drafts = (d.drafts as Array<{ platform: string; title: string; format: string; content: string }>) ?? []
    const platformsUsed = (d.platformsUsed as string[]) ?? []
    const numberEmojis = ['1\uFE0F\u20E3', '2\uFE0F\u20E3', '3\uFE0F\u20E3', '4\uFE0F\u20E3', '5\uFE0F\u20E3', '6\uFE0F\u20E3', '7\uFE0F\u20E3', '8\uFE0F\u20E3', '9\uFE0F\u20E3', '\uD83D\uDD1F']
    const lines = [
      '\u270D\uFE0F *Redator \u2014 Gera\u00E7\u00E3o Completa*',
      '',
      `\uD83D\uDCDD ${d.draftsCreated} drafts criados | \uD83C\uDF10 ${platformsUsed.join(', ').toUpperCase() || 'nenhuma'}`,
      '',
    ]

    for (let i = 0; i < drafts.length; i++) {
      const emoji = numberEmojis[i] ?? `${i + 1}.`
      const platformTag = `[${drafts[i].platform.toUpperCase()}]`
      lines.push(`${emoji} ${platformTag} ${drafts[i].content}`)
      if (i < drafts.length - 1) lines.push('')
    }

    lines.push('')
    lines.push(`\u23F1\uFE0F ${(result.durationMs / 1000).toFixed(1)}s | \uD83E\uDE99 ${result.tokensUsed} tokens`)

    return lines.join('\n')
  }
}

export const agent = new WriterAgent()

/**
 * Remove external links from X/Twitter post content.
 * X penalizes posts that redirect traffic off-platform — only x.com and t.co are safe.
 * Exported for regression testing.
 */
export function stripExternalLinksForX(text: string): string {
  return text
    // Remove https://anything-not-x.com or t.co
    .replace(/https?:\/\/(?!(?:(?:www\.)?(?:x\.com|t\.co|twitter\.com)))[\S]+/gi, '')
    // Collapse multiple spaces left by removed URLs
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/**
 * Parse SRT subtitle text into frame-based entries for Remotion.
 */
function parseSrtToFrames(srt: string, fps: number): Array<{ text: string; startFrame: number; endFrame: number }> {
  if (!srt.trim()) return []

  const blocks = srt.trim().split(/\n\n+/)
  const entries: Array<{ text: string; startFrame: number; endFrame: number }> = []

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue

    const tsMatch = lines[1].match(/(\d+):(\d+):(\d+),(\d+)\s*-->\s*(\d+):(\d+):(\d+),(\d+)/)
    if (!tsMatch) continue

    const g = tsMatch.slice(1).map(Number)
    const startSec = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
    const endSec = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000

    const text = lines.slice(2).join(' ').trim()
    if (!text) continue

    entries.push({
      text,
      startFrame: Math.round(startSec * fps),
      endFrame: Math.round(endSec * fps),
    })
  }

  return entries
}
