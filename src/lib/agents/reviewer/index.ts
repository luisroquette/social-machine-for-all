import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import { getAdminClient } from '@/lib/supabase/admin'
import { getPlatformConfig, type PlatformConfig } from '@/lib/settings/platform-config'
import { buildEngagementInsights } from '@/lib/eval/engagement-insights'
import { getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { hasNegativeEvFraming } from '@/lib/brand/brand-brand-safety'
import { loadWorkspaceFeatures } from '@/lib/config/workspace-features'
import { getPublishableContentText, runQualityGate } from '@/lib/eval/quality-gate'
import type { Json, TablesUpdate } from '@/lib/supabase/database.types'

interface DraftItem {
  id: string
  workspace_id: string
  curated_content_id: string
  target_platform: string
  target_format: string
  content: string
  model_used: string
  review_score: number | null
  metadata: Json | null
}

interface ReviewScore {
  hook: number
  insight: number
  voice: number
  size: number
  identity: number
  politics: number
  overall: number
}

interface ReviewResult {
  draftId: string
  scores: ReviewScore
  approved: boolean
  feedback: string
  issues: string[]
  contentSnippet: string
}

interface CriticalChecks {
  context: number
  correlation: number | null
  coherence: number
  promise_delivery: number
}

class ReviewerAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'reviewer',
      name: 'Revisor',
      role: 'reviewer',
      description: 'Revisa conteudo gerado com scoring multi-dimensional usando modelo diferente',
      defaultModel: 'deepseek-chat',
      pipelineStage: 4,
      maxActionsPerHour: 30,
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    let tokensUsed = 0
    const errors: string[] = []
    const reviews: ReviewResult[] = []
    const features = await loadWorkspaceFeatures(ctx.workspaceId)

    // Load draft content ready for review
    const { data: drafts, error: fetchError } = await supabase
      .from('generated_content')
      .select('*')
      .eq('workspace_id', ctx.workspaceId)
      .eq('status', 'draft')
      .order('created_at', { ascending: true })
      .limit(Number(ctx.settings?.reviewer_max_items_per_run ?? 10))

    if (fetchError) {
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [`Failed to fetch drafts: ${fetchError.message}`],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'fetch_error' },
      }
    }

    if (!drafts?.length) {
      return {
        success: true,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_drafts' },
      }
    }

    // Review each draft
    let autoApprovedCount = 0

    const curatedIds = [...new Set(
      (drafts as DraftItem[])
        .map((draft) => draft.curated_content_id)
        .filter(Boolean),
    )]
    const sourceById = new Map<string, { source_content: string; source_url: string | null }>()
    if (curatedIds.length > 0) {
      const { data: sources } = await supabase
        .from('curated_content')
        .select('id, source_content, source_url')
        .in('id', curatedIds)
      for (const source of sources ?? []) sourceById.set(source.id, source)
    }

    // Insights de engajamento (reach real) — computado 1x, injetado só nos reviews de Instagram.
    const engagementInsights = await buildEngagementInsights(ctx.workspaceId)

    // Pesos configuráveis por workspace — carregados 1x antes do loop.
    const [wHook, wInsight, wVoice, wSize, wIdentity, wPolitics] = await Promise.all([
      getNumericVariable(ctx.workspaceId, 'reviewer_weight_hook'),
      getNumericVariable(ctx.workspaceId, 'reviewer_weight_insight'),
      getNumericVariable(ctx.workspaceId, 'reviewer_weight_voice'),
      getNumericVariable(ctx.workspaceId, 'reviewer_weight_size'),
      getNumericVariable(ctx.workspaceId, 'reviewer_weight_identity'),
      getNumericVariable(ctx.workspaceId, 'reviewer_weight_politics'),
    ])
    const reviewerWeights = {
      hook: wHook,
      insight: wInsight,
      voice: wVoice,
      size: wSize,
      identity: wIdentity,
      politics: wPolitics,
    }

    for (const draft of drafts as DraftItem[]) {
      try {
        const platformConfig = await getPlatformConfig(ctx.workspaceId, draft.target_platform)
        const structuralGate = runQualityGate(draft.content, draft.target_platform, platformConfig ?? undefined)
        if (!structuralGate.passed) {
          const feedback = `Rejeitado pelo gate estrutural: ${structuralGate.issues.join('; ')}`
          await supabase
            .from('generated_content')
            .update({
              status: 'rejected',
              review_score: structuralGate.score,
              review_feedback: feedback,
              review_issues: structuralGate.issues,
            })
            .eq('id', draft.id)
          reviews.push({
            draftId: draft.id,
            scores: { hook: 0, insight: 0, voice: 0, size: 0, identity: 0, politics: 0, overall: structuralGate.score },
            approved: false,
            feedback,
            issues: structuralGate.issues,
            contentSnippet: draft.content.slice(0, 50),
          })
          continue
        }

        // ── BRAND SAFETY brand MOB: roda ANTES do auto-approve e do LLM ──
        // Draft com framing negativo sobre EVs (incêndio, acidente, recall) nunca
        // é aprovado — a brand vende eletromobilidade; manchete de medo afasta o
        // comprador. Ver src/lib/brand/brand-brand-safety.ts (Reel "11 EVS EM
        // CHAMAS", 07/07/2026).
        if (features.negative_ev_guardrail && hasNegativeEvFraming(draft.content)) {
          const issue = 'Brand safety Brand: conteudo associa EV a perigo (incendio/acidente/recall)'
          const { error: updateError } = await supabase
            .from('generated_content')
            .update({
              status: 'rejected',
              review_score: 0,
              review_feedback: 'Rejeitado por brand safety: a Brand vende eletromobilidade — conteudo negativo sobre EVs afasta o comprador.',
              review_issues: [issue],
            })
            .eq('id', draft.id)

          if (updateError) {
            errors.push(`Failed to reject draft ${draft.id}: ${updateError.message}`)
            continue
          }

          await supabase.from('eval_dataset').insert({
            workspace_id: ctx.workspaceId,
            agent_slug: 'writer',
            input_summary: `Draft ${draft.target_format} for ${draft.target_platform}`,
            output_summary: draft.content.slice(0, 200),
            auto_score: 0,
            dimensions: { brand_safety_rejected: true },
            issues: [issue],
            verdict: 'reject',
          })

          reviews.push({
            draftId: draft.id,
            scores: { hook: 0, insight: 0, voice: 0, size: 0, identity: 0, politics: 0, overall: 0 },
            approved: false,
            feedback: 'Rejeitado por brand safety Brand (conteudo negativo sobre EVs).',
            issues: [issue],
            contentSnippet: draft.content.slice(0, 50),
          })
          continue
        }

        // ── AUTO-APPROVE: skip Claude for high-confidence text drafts ──
        const autoResult = this.tryAutoApprove(draft, platformConfig)
        if (autoResult.approved) {
          const { error: updateError } = await supabase
            .from('generated_content')
            .update({
              status: 'approved',
              review_score: autoResult.score,
              review_feedback: autoResult.feedback,
              review_issues: [],
            })
            .eq('id', draft.id)

          if (updateError) {
            errors.push(`Failed to auto-approve draft ${draft.id}: ${updateError.message}`)
            continue
          }

          autoApprovedCount++
          console.log(`[reviewer] Auto-approved draft ${draft.id} (${draft.target_platform}/${draft.target_format}) — score ${autoResult.score}, reason: ${autoResult.feedback}`)

          // Write to eval_dataset for consistency
          await supabase.from('eval_dataset').insert({
            workspace_id: ctx.workspaceId,
            agent_slug: 'writer',
            input_summary: `Draft ${draft.target_format} for ${draft.target_platform}`,
            output_summary: draft.content.slice(0, 200),
            auto_score: autoResult.score,
            dimensions: { auto_approved: true },
            issues: [],
            verdict: 'keep',
          })

          reviews.push({
            draftId: draft.id,
            scores: { hook: 0, insight: 0, voice: 0, size: 0, identity: 0, politics: 0, overall: autoResult.score },
            approved: true,
            feedback: autoResult.feedback,
            issues: [],
            contentSnippet: draft.content.slice(0, 50),
          })
          continue
        }

        const systemPrompt = this.buildSystemPrompt(ctx, platformConfig, engagementInsights)

        const source = sourceById.get(draft.curated_content_id)
        const hasSource = Boolean(source?.source_content?.trim())
        const userMessage = [
          '## Conteudo para Revisao',
          `Plataforma: ${draft.target_platform}`,
          `Formato: ${draft.target_format}`,
          `Modelo que gerou: ${draft.model_used}`,
          '',
          '## Texto:',
          draft.content,
          '',
          '## Fonte original para verificacao factual:',
          source?.source_content ?? 'Fonte original indisponivel. Use correlation = null; avalie context apenas pela clareza interna do draft.',
          source?.source_url ? `URL: ${source.source_url}` : '',
          '',
          `Alertas deterministicos para confirmar, nao reprovar automaticamente: ${structuralGate.warnings.join('; ') || 'nenhum'}`,
          '',
          'Avalie e retorne APENAS o JSON abaixo — sem texto antes, sem explicacao, sem markdown:',
          `{"scores":{"hook":0,"insight":0,"voice":0,"size":0,"identity":10,"politics":10},"critical_checks":{"context":0,"correlation":${hasSource ? '0' : 'null'},"coherence":0,"promise_delivery":0},"blocking_issues":[],"improvements":[],"feedback":"feedback aqui"}`,
          '',
          'Regras para cada campo:',
          '- scores.*: inteiro 0-10 conforme calibracao do system prompt',
          '- critical_checks.*: inteiro 0-10 quando aplicavel; correlation deve ser null quando a fonte estiver indisponivel',
          '- blocking_issues: somente fatos inventados, contradicoes, promessa nao entregue ou violacoes objetivas que impedem publicacao',
          '- improvements: refinamentos desejaveis que nao impedem publicacao',
          '- feedback: 1-2 frases em portugues, especificas ao problema principal',
          'A primeira linha da resposta deve ser "{" e a ultima "}".',
        ].join('\n')

        const resolvedModel = ctx.dbConfig?.model ?? await getVariable(ctx.workspaceId, 'reviewer_model')

        const result = await generateSimpleText({
          model: resolvedModel,
          systemPrompt,
          userMessage,
          maxTokens: 1500,
          temperature: ctx.dbConfig?.temperature ?? 0.5,
        })

        tokensUsed += result.tokensUsed

        // Parse review response
        const parsed = parseAIJson<{
          scores: Omit<ReviewScore, 'overall'>
          critical_checks: Partial<CriticalChecks>
          feedback: string
          blocking_issues?: string[]
          improvements?: string[]
        }>(result.text, `reviewer draft: ${draft.id}`)
        const blockingIssues = Array.isArray(parsed.blocking_issues) ? [...parsed.blocking_issues] : []
        const improvements = Array.isArray(parsed.improvements) ? [...parsed.improvements] : []

        // Calculate weighted overall score
        const clamp = (n: number) => Math.max(0, Math.min(10, Math.round(n)))
        const overall = Object.entries(reviewerWeights).reduce((sum, [dim, weight]) => {
          const score = parsed.scores[dim as keyof typeof parsed.scores] ?? 0
          return sum + score * weight
        }, 0)

        const roundedOverall = Math.round(overall * 10) / 10
        let approvalThreshold = Number(ctx.settings?.reviewer_approval_threshold ?? 7)
        // Normalize: if stored as percentage (0-100) instead of score (0-10), convert it
        if (approvalThreshold > 10) approvalThreshold = approvalThreshold / 10
        let approved = roundedOverall >= approvalThreshold

        const scores: ReviewScore = {
          hook: clamp(parsed.scores?.hook ?? 0),
          insight: clamp(parsed.scores?.insight ?? 0),
          voice: clamp(parsed.scores?.voice ?? 0),
          size: clamp(parsed.scores?.size ?? 0),
          identity: clamp(parsed.scores?.identity ?? 0),
          politics: clamp(parsed.scores?.politics ?? 0),
          overall: roundedOverall,
        }

        // Red flags: auto-reject regardless of overall score
        // Threshold < 3 (not < 5) because identity/politics are effectively binary —
        // a score of 4-5 means "ambiguous/borderline", not a clear violation
        const redFlags: string[] = []
        const publishableText = getPublishableContentText(draft.content)
        if (scores.identity < 3) redFlags.push('Possivel fraude de identidade')
        if (scores.politics < 3) redFlags.push('Conteudo politico-partidario')
        const criticalChecks: CriticalChecks = {
          context: clamp(parsed.critical_checks?.context ?? 0),
          correlation: hasSource ? clamp(parsed.critical_checks?.correlation ?? 0) : null,
          coherence: clamp(parsed.critical_checks?.coherence ?? 0),
          promise_delivery: clamp(parsed.critical_checks?.promise_delivery ?? 0),
        }
        const hardMinimums: Record<keyof CriticalChecks, number> = {
          context: 6,
          correlation: 7,
          coherence: 6,
          promise_delivery: 6,
        }
        for (const [dimension, value] of Object.entries(criticalChecks) as Array<[keyof CriticalChecks, number | null]>) {
          if (value === null) continue
          if (value < hardMinimums[dimension]) {
            redFlags.push(`Falha critica em ${dimension}: ${value}/10`)
          } else if (value < 8) {
            improvements.push(`Melhoria recomendada em ${dimension}: ${value}/10`)
          }
        }

        // Platform-specific red flags
        if (platformConfig) {
          if (publishableText.length > platformConfig.maxLength) {
            redFlags.push(`Excede ${platformConfig.maxLength} chars (${publishableText.length})`)
          }
          if (!platformConfig.allowHashtags && /#\w+/.test(publishableText)) {
            redFlags.push('Hashtags proibidas nesta plataforma')
          }
          // Check for emojis only on platforms that don't allow them
          if (!platformConfig.allowEmojis) {
            const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
            if (emojiRegex.test(publishableText)) {
              redFlags.push('Contem emojis (proibido nesta plataforma)')
            }
          }
          // Don't penalize hashtags on LinkedIn/Instagram
          // External links on X: algorithm penalizes any non-x.com/twitter.com URL
          const isXPlatform = platformConfig.platform === 'x' || platformConfig.platform === 'twitter'
          if (isXPlatform && /https?:\/\/(?!(?:x\.com|twitter\.com)\b)\S+/i.test(publishableText)) {
            redFlags.push('Contem link externo (proibido no X — algoritmo penaliza)')
          }
        } else {
          // Fallback to X rules
          const tweetMaxLength = await getNumericVariable(ctx.workspaceId, 'tweet_max_length')
          if (publishableText.length > tweetMaxLength) redFlags.push(`Excede ${tweetMaxLength} chars (${publishableText.length})`)
          if (/#\w+/.test(publishableText)) redFlags.push('Contem hashtags')
          const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
          if (emojiRegex.test(publishableText)) {
            redFlags.push('Contem emojis (proibido)')
          }
          // External links on X (fallback path)
          if (/https?:\/\/(?!(?:x\.com|twitter\.com)\b)\S+/i.test(publishableText)) {
            redFlags.push('Contem link externo (proibido no X — algoritmo penaliza)')
          }
        }

        if (redFlags.length > 0 || blockingIssues.length > 0) {
          approved = false
          blockingIssues.push(...redFlags)
        }

        // Add weakest dimension to issues list (not prepended to feedback text)
        const weakest = Object.entries(scores)
          .filter(([k]) => k !== 'overall')
          .sort((a, b) => (a[1] as number) - (b[1] as number))[0]
        if (weakest && (weakest[1] as number) < 7) {
          improvements.push(`Dimensao mais fraca: ${weakest[0]} (${weakest[1]}/10)`)
        }

        // Update generated_content status
        const existingMetadata = draft.metadata && typeof draft.metadata === 'object' && !Array.isArray(draft.metadata)
          ? draft.metadata as Record<string, Json | undefined>
          : {}
        const updateData: Record<string, unknown> = {
          status: approved ? 'approved' : 'rejected',
          review_score: roundedOverall,
          review_feedback: parsed.feedback,
          review_issues: blockingIssues,
          metadata: {
            ...existingMetadata,
            editorial_quality_review: { critical_checks: criticalChecks, blocking_issues: blockingIssues, improvements },
          },
        }

        const { error: updateError } = await supabase
          .from('generated_content')
          .update(updateData as TablesUpdate<'generated_content'>)
          .eq('id', draft.id)

        if (updateError) {
          errors.push(`Failed to update draft ${draft.id}: ${updateError.message}`)
          continue
        }

        // Write to eval_dataset for learning
        await supabase.from('eval_dataset').insert({
          workspace_id: ctx.workspaceId,
          agent_slug: 'writer',
          input_summary: `Draft ${draft.target_format} for ${draft.target_platform}`,
          output_summary: draft.content.slice(0, 200),
          auto_score: roundedOverall,
          dimensions: { ...scores, critical_checks: criticalChecks, improvements } as unknown as Json,
          issues: blockingIssues,
          verdict: approved ? 'keep' : 'reject',
        })

        reviews.push({
          draftId: draft.id,
          scores,
          approved,
          feedback: parsed.feedback,
          issues: blockingIssues,
          contentSnippet: draft.content.slice(0, 50),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`Error reviewing draft ${draft.id}: ${message}`)
      }
    }

    const approvedCount = reviews.filter(r => r.approved).length
    const rejectedCount = reviews.filter(r => !r.approved).length
    const avgScore = reviews.length > 0
      ? reviews.reduce((sum, r) => sum + r.scores.overall, 0) / reviews.length
      : 0

    return {
      success: reviews.length > 0 || errors.length === 0,
      itemsProcessed: drafts.length,
      itemsProduced: approvedCount,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.000003,
      durationMs: Date.now() - startTime,
      details: {
        reviewed: reviews.length,
        approved: approvedCount,
        rejected: rejectedCount,
        autoApproved: autoApprovedCount,
        avgScore: Math.round(avgScore * 10) / 10,
        reviews: reviews.map(r => ({
          draftId: r.draftId,
          overall: r.scores.overall,
          approved: r.approved,
          issues: r.issues,
          feedback: r.feedback,
          contentSnippet: r.contentSnippet,
        })),
      },
    }
  }

  /**
   * Deterministic pre-check: auto-approve drafts that pass all red-flag checks
   * without spending Claude tokens. Only applies to simple text formats (not reels/carousels).
   */
  private tryAutoApprove(
    draft: DraftItem,
    platformConfig: PlatformConfig | null,
  ): { approved: boolean; score: number; feedback: string } {
    const NO = { approved: false, score: 0, feedback: '' }

    // Never auto-approve formats that need visual/structural review
    const visualFormats = ['reel', 'carousel', 'slideshow', 'video']
    if (visualFormats.includes(draft.target_format)) return NO

    // If the writer already had a review_score >= 8 from a previous cycle, trust it
    if (draft.review_score !== null && draft.review_score >= 8) {
      return {
        approved: true,
        score: draft.review_score,
        feedback: `Auto-approved: pre-existing high score (${draft.review_score})`,
      }
    }

    // Run the same deterministic red-flag checks the full review does
    const content = draft.content
    const platform = platformConfig?.platform ?? 'x'
    const maxLength = platformConfig?.maxLength ?? 280
    const allowHashtags = platformConfig?.allowHashtags ?? false
    const allowEmojis = platformConfig?.allowEmojis ?? false

    // Length check — measures the extracted caption (what actually gets published),
    // not the raw content field, which for structured Brand JSON also includes
    // headline/context/kpi/image_prompt and inflates the count.
    if (getPublishableContentText(content).length > maxLength) return NO

    // Too short — likely a parsing artifact
    if (content.trim().length < 30) return NO

    // Hashtag check
    if (!allowHashtags && /#\w+/.test(content)) return NO

    // Emoji check
    const emojiRegex = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u
    if (!allowEmojis && emojiRegex.test(content)) return NO

    // Generic AI phrases (same list from the system prompt)
    const aiBotPhrases = [
      'acabei de ler', 'acabei de ver', 'acabei de testar',
      'e impressionante', 'o impacto e', 'o futuro e',
      'revolucionario', 'game-changer',
      'nao e segredo que', 'nao e nenhuma surpresa',
      'em um mundo onde', 'na era da ia',
      'desbloquear o potencial', 'transformar a maneira como',
      'mergulhar fundo', 'vamos explorar',
      'sem mais delongas', 'dito isso',
      'e importante notar que', 'vale ressaltar',
    ]
    const lower = content.toLowerCase()
    if (aiBotPhrases.some(phrase => lower.includes(phrase))) return NO

    // Content must have at least one density signal (number, comparison, named entity)
    const hasNumber = /\d+/.test(content)
    const hasComparison = /\bvs\.?\b/i.test(content) || /\bcontra\b/i.test(content)
    if (!hasNumber && !hasComparison) return NO

    // Platform-specific: Instagram requires hashtags
    if (platform === 'instagram' && !/#\w+/.test(content)) return NO

    // All checks passed — auto-approve with a conservative score of 8
    return {
      approved: true,
      score: 8,
      feedback: `Auto-approved: passed all deterministic quality checks (${platform}/${draft.target_format})`,
    }
  }

  private buildSystemPrompt(ctx: RunContext, platformConfig: PlatformConfig | null, engagementInsights = ''): string {
    const platform = platformConfig?.platform ?? 'x'
    const maxLength = platformConfig?.maxLength ?? 280
    const allowHashtags = platformConfig?.allowHashtags ?? false
    const allowEmojis = platformConfig?.allowEmojis ?? false

    const lines = [
      'Voce e um revisor editorial rigoroso para conteudo de redes sociais.',
      'Sua missao e garantir qualidade, autenticidade e seguranca de marca antes da publicacao.',
      'IMPORTANTE: Voce usa um modelo DIFERENTE do que gerou o conteudo, proporcionando uma revisao cruzada imparcial.',
      '',
      `## Plataforma: ${platform.toUpperCase()} (max ${maxLength} chars)`,
      '',
      'IMPORTANTE: Voce e um revisor RIGOROSO. Sua taxa de aprovacao IDEAL e 60-70%, nao 100%.',
      'Se voce esta aprovando tudo, voce esta sendo leniente demais.',
      'Seja critico. O conteudo precisa ser EXCELENTE para pontuar acima de 8.',
      'Score 7 e MEDIANO, nao bom. Score 9+ e RARO e excepcional.',
      '',
      'Calibracao de scores:',
      '- 9-10: Top 5% — viral potential, insight unico, gancho perfeito',
      '- 8: BOM — publicavel com qualidade, cumpre todos os requisitos basicos sem ser excepcional',
      '- 7-8: Bom, publicavel — cumpre o basico com qualidade',
      '- 5-6: Mediano — precisa de revisao, problemas claros',
      '- 1-4: Fraco — rejeitar sem duvida',
      '',
      'Rejeite IMEDIATAMENTE se:',
      `- Conteudo com mais de ${maxLength} caracteres`,
      '- Contem frases genericas de IA',
      '- Se passa por outra pessoa',
      '- Conteudo politico-partidario',
      '- Conteudo totalmente ficcional sem qualquer base (ex: narrativa inventada sem fonte)',
      '',
      'NAO rejeite por:',
      '- Nomes de modelos, produtos ou empresas que voce nao conhece — seu conhecimento tem data de corte e novos lancamentos acontecem constantemente',
      '- Versoes de modelos recentes — podem ser reais mesmo que voce nao as conheca',
      'REJEITE se:',
      '- O draft menciona modelos/versoes/metricas que claramente NAO estao no conteudo fonte que foi passado ao writer (ex: a fonte fala de "OpenAI" generico mas o draft inventa "GPT-5.5 lider em raciocinio")',
      '- O draft adiciona comparacoes, rankings ou benchmarks que nao existem na fonte original',
      '',
      '## Dimensoes de Avaliacao (0-10 cada):',
      '',
      '### hook (Gancho) - Peso 20%',
      'O conteudo captura atencao imediatamente? Gera curiosidade? Faz a pessoa parar o scroll?',
      '- 9-10: Impossivel ignorar, gancho irresistivel',
      '- 7-8: Bom gancho, desperta interesse',
      '- 5-6: Mediano, nao se destaca',
      '- 1-4: Fraco, facilmente ignoravel',
      '',
      '### insight (Valor) - Peso 20%',
      'O conteudo traz informacao util, perspectiva unica ou dado relevante para o publico-alvo?',
      'CALIBRACAO PARA CONTEUDO GENERALISTA: Posts para publico geral (usuarios de ChatGPT, nao pesquisadores)',
      'devem ser avaliados por clareza e relevancia pratica — NAO por densidade tecnica.',
      'Conteudo ESPECIFICO e CLARO para o leitor comum e um insight de qualidade.',
      'Exemplos de insight BONS (acessiveis mas especificos):',
      '  "O ChatGPT agora lembra tudo que voce disse nas ultimas conversas" → ESPECIFICO, UTIL → score 8',
      '  "A OpenAI lancou uma IA que escreve codigo enquanto voce assiste" → CONCRETO → score 8',
      'Exemplos de insight FRACOS (vacos):',
      '  "A IA esta ficando mais inteligente" → VAGO, sem dado → score 4',
      '  "Isso vai mudar tudo" → OBVIO, sem substancia → score 2',
      '- 9-10: Insight original e valioso — com dado especifico ou aplicacao concreta',
      '- 7-8: Informacao util e bem apresentada para o publico-alvo',
      '- 5-6: Conteudo generico sem especificidade — vale para qualquer coisa',
      '- 1-4: Obvio, superficial, vago ou incorreto',
      '',
      '### voice (Voz) - Peso 20%',
      'O tom e consistente com a marca? Soa natural e humano?',
      '- 9-10: Voz autentica e inconfundivel',
      '- 7-8: Consistente com a marca',
      '- 5-6: Generico, poderia ser de qualquer perfil',
      '- 1-4: Soa robotic, com frases tipicas de IA',
      '',
      '### size (Tamanho) - Peso 15%',
      'O conteudo respeita os limites da plataforma? E conciso e bem formatado?',
      '- 9-10: Tamanho perfeito, cada palavra conta, nada a remover nem adicionar',
      '- 7-8: Dentro dos limites, bem estruturado',
      '- 5-6: Proximo do limite maximo (>90% do max) ou levemente curto (<40% do ideal)',
      '- 3-4: MUITO CURTO — conteudo insuficiente, falta substancia (aponte no feedback: "muito curto")',
      '- 1-2: EXCEDE O LIMITE — ultrapassa o maximo de caracteres da plataforma (aponte no feedback: "excede o limite")',
      'IMPORTANTE: diferencie no feedback se o problema e "muito curto" ou "muito longo" — sao correccoes opostas.',
      '',
      '### identity (Identidade) - Peso 15%',
      'O conteudo NAO se passa por outra pessoa, marca ou autoridade que nao e?',
      '- 10: Sem problemas de identidade',
      '- 5: Ambiguo, pode parecer que e outra pessoa',
      '- 0: Claramente se passando por alguem',
      '',
      '### politics (Politica) - Peso 10%',
      'O conteudo evita posicionamento politico-partidario?',
      '- 10: Neutro, sem conteudo politico',
      '- 5: Levemente politico mas aceitavel',
      '- 0: Conteudo politico-partidario explicito',
      '',
      '## Checks de Decisao (0-10 quando aplicavel):',
      '### context: o leitor entende quem, o que, quando e por que isso importa sem conhecimento externo?',
      '### correlation: cada afirmacao, numero e conclusao decorre da fonte original e do visual proposto?',
      '### coherence: capa, slides e legenda tratam do mesmo assunto e formam uma narrativa logica?',
      '### promise_delivery: tudo que capa/gancho promete e efetivamente mostrado ou explicado depois?',
      'Use correlation = null quando a fonte original estiver indisponivel; nao invente uma nota baixa por falta de evidencia.',
      'Notas 6-7 indicam melhoria, nao reprovação automatica. Reprove por estes checks apenas falhas claras abaixo do minimo informado no pedido.',
      'Para carousel, rejeite se a capa sugere videos, exemplos, lista ou demonstracao e os slides nao os exibem individualmente.',
      'Uma capa generica e um alerta, nao veto isolado: rejeite somente se slides e legenda tambem nao especificarem nem entregarem o assunto.',
      'blocking_issues deve conter apenas falhas objetivas que impedem publicacao.',
      'improvements deve conter refinamentos opcionais; melhorias nunca sao motivo isolado de rejeicao.',
      '',
      '## Checklist Obrigatorio:',
      '- Gramatica e ortografia em portugues corretas',
      '- Sem frases genericas de IA ("neste artigo", "e importante destacar", "em um mundo cada vez mais")',
      '- Consistencia com a voz da marca',
      `- Tamanho adequado para a plataforma (max ${maxLength} chars)`,
      '- Sem conteudo politico-partidario',
      '- Sem fraude de identidade',
      '- Potencial de engajamento',
    ]

    // Platform-specific penalization rules
    if (platform === 'x') {
      lines.push(
        '',
        '## Penalizacoes Adicionais (estilo @0xCVYH para X/Twitter):',
        '',
        'Hashtags no X/Twitter = REJEICAO IMEDIATA (voice = 0, approved = false)',
        '',
        '### Emojis — PENALIZACAO SEVERA',
        'Se o tweet contem emojis, score voice -= 3',
      )
    } else if (platform === 'linkedin') {
      lines.push(
        '',
        '## Regras especificas para LinkedIn:',
        '',
        '### Hashtags — PERMITIDAS (3-5 hashtags estrategicas)',
        'Hashtags sao esperadas no LinkedIn. Avalie se sao relevantes e bem posicionadas.',
        'Penalize apenas se > 5 hashtags ou hashtags irrelevantes.',
        '',
        '### Emojis — PERMITIDOS (1-2 estrategicos)',
        'Emojis moderados sao aceitaveis para destacar pontos. Penalize excesso (> 3).',
      )
    } else if (platform === 'instagram') {
      lines.push(
        '',
        '## Regras especificas para Instagram:',
        '',
        '### Hashtags — OBRIGATORIAS (10-20 hashtags)',
        'Instagram requer hashtags para alcance. Penalize se < 10 ou > 20.',
        'Avalie mix de hashtags populares e de nicho.',
        '',
        '### Emojis — ENCORAJADOS',
        'Emojis sao parte da linguagem do Instagram. Penalize apenas ausencia total.',
        '',
        '### Referencia visual — ESPERADA',
        'O conteudo deve complementar uma imagem. Verifique se o texto faz sentido como legenda.',
        '',
        '### SE FORMAT = "reel" (Instagram Reel):',
        'O conteudo sera um JSON com slides. Avalie diferente:',
        '',
        '**hook (Peso 3x para Reels):**',
        '- O PRIMEIRO slide DEVE ser um gancho forte (pergunta, stat, afirmacao bold)',
        '- Se o slide 1 e fraco/generico: hook = 2 (max), REJEITAR',
        '- 9-10: Impossivel nao assistir ate o final',
        '',
        '**slide_readability:**',
        '- Max 15 palavras por slide. Se qualquer slide > 15 palavras: size -= 4',
        '- Texto deve ser legivel em tela de celular',
        '',
        '**loop_potential:**',
        '- O ultimo slide deve conectar tematicamente ao primeiro',
        '- Se conecta bem: insight += 2. Se nao: insight -= 1',
        '',
        '**cta_presence:**',
        '- Ultimo slide DEVE ter call-to-action (seguir, comentar, compartilhar)',
        '- Sem CTA: voice -= 2',
        '',
        '**slide_count:**',
        '- 3-5 slides ideal. < 3 ou > 6: size -= 3',
        '',
        '**caption com hashtags:**',
        '- Caption deve ter 10-20 hashtags relevantes (avaliado normalmente)',
      )
    } else {
      lines.push(
        '',
        '## Penalizacoes Adicionais:',
        '',
        allowHashtags
          ? `### Hashtags — PERMITIDAS (max ${platformConfig?.maxHashtags ?? 5})`
          : '### Hashtags — REJEICAO IMEDIATA',
        allowEmojis
          ? '### Emojis — PERMITIDOS com moderacao'
          : '### Emojis — PENALIZACAO SEVERA',
      )
    }

    lines.push(
      '',
      '### Frases genericas de bot:',
      'Se contem "acabei de ler/ver/testar", "e impressionante", "o impacto e", "o futuro e":',
      'score voice = 2 (maximo)',
      '',
      '### Ausencia de dados concretos:',
      'Se o conteudo NAO contem nenhum numero, benchmark, comparacao ou dado especifico:',
      'score insight -= 4',
      '',
      '### Formato paragrafo corrido:',
      `Se o conteudo e um paragrafo unico sem bullet points ou comparacoes e tem mais de ${Math.round(maxLength * 0.7)} chars:`,
      'score hook -= 2',
      '',
      '## Limiar de Aprovacao:',
      'Score geral >= 7.0 = APROVADO',
      'Score geral < 7.0 = REJEITADO (incluir feedback detalhado)',
    )

    if (ctx.brandContext) {
      lines.push('', '## Contexto da Marca (use para avaliar consistencia de voz):', ctx.brandContext)
    }

    if (ctx.feedbackContext) {
      lines.push('', '## Guardrails de Feedback (padroes conhecidos a verificar):', ctx.feedbackContext)
    }

    // Instagram: o que de fato deu reach (engajamento real) — calibra a avaliacao do gancho.
    if (platform === 'instagram' && engagementInsights) {
      lines.push('', engagementInsights)
    }

    lines.push(
      '',
      '## Formato de Resposta:',
      'Retorne APENAS JSON valido. Nenhum texto adicional.',
      '{"scores":{"hook":8,"insight":7,"voice":9,"size":8,"identity":10,"politics":10},"critical_checks":{"context":8,"correlation":8,"coherence":8,"promise_delivery":8},"blocking_issues":[],"improvements":["refinamento opcional"],"feedback":"Feedback geral aqui"}',
    )

    return lines.join('\n')
  }

  async evaluate(result: AgentResult, _ctx: RunContext): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const reviewed = (d.reviewed as number) ?? 0
    const approved = (d.approved as number) ?? 0
    const rejected = (d.rejected as number) ?? 0
    const avgScore = (d.avgScore as number) ?? 0
    const total = result.itemsProcessed || 1

    const completionRate = reviewed / total

    return {
      agentSlug: 'reviewer',
      inputSummary: `${result.itemsProcessed} drafts to review`,
      outputSummary: `${approved} approved, ${rejected} rejected (avg: ${avgScore})`,
      autoScore: Math.max(1, Math.min(10, Math.round(completionRate * 10))),
      dimensions: {
        completeness: completionRate >= 0.9 ? 10 : completionRate >= 0.7 ? 7 : 4,
        discrimination: approved > 0 && rejected > 0 ? 9 : approved > 0 ? 7 : 5,
        avgContentScore: avgScore,
      },
      issues: result.errors,
      verdict: completionRate >= 0.8 ? 'keep' : completionRate >= 0.5 ? 'improve' : 'reject',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>
    if (!result.success) {
      return `\u274C *Revisor* \u2014 Erro: ${result.errors[0]}`
    }

    const reviews = (d.reviews as Array<{ draftId: string; overall: number; approved: boolean; issues: string[]; feedback: string; contentSnippet: string }>) ?? []
    const lines = [
      '\uD83D\uDD0E *Revisor \u2014 Revis\u00E3o Completa*',
      '',
      `\uD83D\uDCCA ${d.reviewed} revisados | \u2705 ${d.approved} aprovados${(d.autoApproved as number) > 0 ? ` (\u26A1${d.autoApproved} auto)` : ''} | \u274C ${d.rejected} rejeitados`,
      `Score m\u00E9dio: ${d.avgScore}/10`,
      '',
    ]

    for (const review of reviews) {
      const status = review.approved ? '\u2705' : '\u274C'
      let line = `${status} ${review.overall} \u2014 "${review.contentSnippet}..."`
      if (!review.approved && review.issues.length > 0) {
        line += ` \u2192 _${review.issues[0]}_`
      }
      lines.push(line)
    }

    lines.push('')
    lines.push(`\u23F1\uFE0F ${(result.durationMs / 1000).toFixed(1)}s | \uD83E\uDE99 ${result.tokensUsed} tokens`)

    return lines.join('\n')
  }
}

export const agent = new ReviewerAgent()
