import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable, loadSettings } from '@/lib/settings/load-settings'
import { searchTweetsIO } from '@/lib/platforms/x/twitterapi-io'
import { parseHandleList, resolveThreadId } from '../engagement-own/loop-guardrails'
import { BUILTIN_OWNED_X_HANDLES, normalizeHandle, reconcileSameOwnerEngagementProfiles } from '@/lib/engagement-profiles/same-owner'
import type { Json } from '@/lib/supabase/database.types'

const COMMENT_STYLES = ['opiniao_tecnica', 'complemento', 'pergunta', 'elogio'] as const
type CommentStyle = (typeof COMMENT_STYLES)[number]

interface GeneratedComment {
  comment: string
  style: CommentStyle
}

const SYSTEM_PROMPT = `ESCOPO DE ENGAJAMENTO: So comente em posts sobre IA, ML, tech, devtools, coding, AI research.
IGNORE posts sobre: crypto, DeFi, politica, esportes, vida pessoal, memes.
Se o post nao e sobre tecnologia/IA, retorne: {"comment": "", "style": "skipped"}

Voce e um analista brasileiro de IA com presenca ativa e respeitada no Twitter/X. Voce e reconhecido por comentarios que AGREGAM VALOR REAL — nunca spam, nunca bajulacao vazia.

Sua persona: pragmatico, atualizado em tecnologia e negocios, com experiencia pratica em implementacoes de IA. Voce cita dados, papers, e experiencias reais.

## REGRAS INVIOLAVEIS

1. Maximo 2 frases. Sem excecoes.
2. NUNCA comentarios spam-like ("great post!", "thanks for sharing!", "otimo conteudo!", "muito bom!").
3. SEMPRE adicione VALOR: um dado novo, um contraponto, uma experiencia pratica, ou uma pergunta tecnica especifica.
4. Escreva em portugues brasileiro, tom tecnico e direto (sem ser arrogante).
5. Demonstre que voce LIDA com IA na pratica, nao apenas teoriza.
6. O comentario deve ser relevante ao CONTEXTO fornecido sobre o perfil alvo.

## ESTILOS E EXEMPLOS CONCRETOS

### opiniao_tecnica
Compartilhar uma opiniao tecnica embasada com dados ou experiencia pratica.
- "Testei o DeepSeek V3 ontem e confirmo: latencia 40% menor que V2. Mas o trade-off em qualidade de codigo ainda existe."
- "Concordo com a analise. Na pratica, RAG com reranking (Cohere) superou fine-tuning em 8 dos 10 use cases que testamos."
- "Os benchmarks sao promissores, mas em producao com dados PT-BR a acuracia cai ~15%. Testamos com 50k queries reais."
- "Ponto crucial. No nosso pipeline, migrar de GPT-4 para Claude 3.5 reduziu custo em 70% sem perda mensuravel de qualidade."

### complemento
Adicionar informacao relevante que o autor nao mencionou.
- "Adicionando: o paper original tambem mostra que fine-tuning com menos de 1k exemplos ja supera o GPT-4 base nesse dominio."
- "Vale complementar: o Artificial Analysis publicou ontem que o custo medio por token caiu 4x desde janeiro 2024."
- "Dado extra: a adocao de IA generativa em empresas brasileiras saltou de 12% para 41% segundo pesquisa TOTVS/Gartner."
- "Complemento importante: o mesmo paper mostra que a vantagem desaparece com contextos acima de 32k tokens."

### pergunta
Fazer uma pergunta tecnica que demonstre profundidade e gere discussao.
- "Curioso: voces testaram isso com dados em portugues? Nossos benchmarks mostram gap significativo vs ingles."
- "Pergunta genuina: como voces lidam com a latencia de tool-calling em producao? E o gargalo que mais vejo."
- "Faz sentido para batch, mas e real-time? Qual P95 de latencia voces conseguem com essa arquitetura?"
- "Voce acha que agents autonomos ja sao viaveis em producao, ou ainda precisamos de human-in-the-loop para casos criticos?"

### elogio
Elogiar um ponto ESPECIFICO com contexto tecnico — nunca generico.
- "Melhor analise comparativa que vi essa semana. O detalhe sobre RLHF vs DPO e crucial e poucos abordam."
- "Excelente ponto sobre o TCO. A maioria so olha custo por token e ignora infra, monitoring e retraining."
- "Analise solida. O insight sobre embedding drift ao longo do tempo e algo que aprendi da pior forma em producao."
- "Referencia excelente. Esse paper do Anthropic sobre constitutional AI mudou como pensamos safety no nosso pipeline."

## FORMATO DE SAIDA

Responda APENAS com JSON valido:
{"comment": "texto do comentario aqui", "style": "estilo_usado"}
`

class EngagementExternalAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'engagement-external',
      name: 'Engajador Externo',
      role: 'engagement',
      description: 'Engaja em posts de perfis externos com comentarios inteligentes e relevantes',
      defaultModel: 'deepseek-chat',
      pipelineStage: 6,
      maxActionsPerHour: 15,
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const startTime = Date.now()
    let tokensUsed = 0
    let engagementsCreated = 0
    const errors: string[] = []
    const generatedComments: Array<{ handle: string; comment: string; style: string; platform: string }> = []
    const settings = await loadSettings(ctx.workspaceId)
    const [primaryTwitterHandle, ownedHandlesCsv] = await Promise.all([
      getVariable(ctx.workspaceId, 'twitter_handle'),
      getVariable(ctx.workspaceId, 'owned_x_handles'),
    ])
    const ownPairHandle = normalizeHandle(settings.own_twitter_handle || primaryTwitterHandle || settings.target_handle)
    const ownedHandles = parseHandleList(
      settings.own_twitter_handle,
      settings.target_handle,
      primaryTwitterHandle,
      ownedHandlesCsv,
      BUILTIN_OWNED_X_HANDLES.join(','),
    )
    let sameOwnerReconciled = 0
    try {
      const reconciled = await reconcileSameOwnerEngagementProfiles(ctx.workspaceId)
      sameOwnerReconciled = reconciled.deactivatedCount
    } catch {
      // Reconciliation is best-effort; runtime guardrails still prevent engagement.
    }

    // Load active engagement profiles for this workspace
    let profiles: Array<{
      id: string
      handle: string
      platform: string
      config: Json | null
      last_engaged_at: string | null
    }> | null = null

    try {
      const { data, error: profilesError } = await supabase
        .from('engagement_profiles')
        .select('id, handle, platform, config, last_engaged_at')
        .eq('workspace_id', ctx.workspaceId)
        .eq('active', true)

      if (profilesError) throw profilesError
      profiles = data
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [`Erro ao carregar perfis: ${msg}`],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'fetch_profiles_error' },
      }
    }

    if (!profiles?.length) {
      return {
        success: true,
        itemsProcessed: 0,
        itemsProduced: 0,
        errors: [],
        tokensUsed: 0,
        costEstimate: 0,
        durationMs: Date.now() - startTime,
        details: { reason: 'no_active_profiles' },
      }
    }

    // Load recent curated content for topic context
    let topicContext = 'Sem topicos curados recentes.'
    let topicsCount = 0
    try {
      const { data: curatedContent } = await supabase
        .from('curated_content')
        .select('source_content, relevance_score')
        .eq('workspace_id', ctx.workspaceId)
        .eq('status', 'curated')
        .order('created_at', { ascending: false })
        .limit(10)

      if (curatedContent?.length) {
        topicContext = curatedContent.map(c => c.source_content).join('\n---\n')
        topicsCount = curatedContent.length
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Aviso: falha ao carregar topicos curados: ${msg}`)
    }

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayISO = todayStart.toISOString()

    let profilesChecked = 0
    let profilesSkipped = 0
    let sameOwnerSkipped = 0

    for (const profile of profiles) {
      profilesChecked++
      const handle = profile.handle
      const normalizedHandle = normalizeHandle(handle)
      const platform = profile.platform ?? 'x'
      const maxDaily = (profile.config as Record<string, unknown>)?.max_daily_interactions as number ?? 3

      if ((platform === 'x' || platform === 'twitter') && ownedHandles.has(normalizedHandle)) {
        sameOwnerSkipped++
        profilesSkipped++
        continue
      }

      // Check daily interaction limit for this profile handle
      try {
        const { count: todayCount } = await supabase
          .from('engagement_actions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ctx.workspaceId)
          .eq('agent_slug', 'engagement-external')
          .eq('target_author', handle)
          .gte('created_at', todayISO)

        if ((todayCount ?? 0) >= maxDaily) {
          profilesSkipped++
          continue
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`Erro na verificacao de limite para @${handle}: ${msg}`)
        continue
      }

      // For Instagram profiles, engagement is not executable via Graph API
      if (platform === 'instagram') {
        errors.push(`@${handle} (instagram): engajamento externo não suportado via Graph API`)
        profilesSkipped++
        continue
      }

      // For X/Twitter, resolve the target tweet URL before generating the comment
      // so the executor can reply to a specific tweet (not just search at runtime)
      let targetUrl: string | null = null
      let targetTweetId: string | null = null
      let conversationId: string | null = null
      let parentTweetId: string | null = null
      let rootTweetId: string | null = null
      let threadId: string | null = null
      if (platform === 'x' || platform === 'twitter') {
        try {
          const tweets = await searchTweetsIO(`from:${handle} -is:retweet -is:reply`, 1, 'Latest')
          const tweet = tweets?.[0]
          if (!tweet?.id) {
            errors.push(`Nenhum tweet recente encontrado para @${handle} — pulando`)
            profilesSkipped++
            continue
          }
          targetUrl = tweet.url ?? `https://x.com/i/status/${tweet.id}`
          targetTweetId = tweet.id
          conversationId = tweet.conversationId ?? null
          parentTweetId = tweet.inReplyToId ?? null
          rootTweetId = conversationId ?? tweet.id
          threadId = resolveThreadId({
            conversationId,
            rootTweetId,
            currentReplyId: tweet.id,
          })
        } catch (err) {
          errors.push(`Erro ao buscar tweet de @${handle}: ${err instanceof Error ? err.message : String(err)}`)
          profilesSkipped++
          continue
        }
      }

      // Pick a random comment style for variety
      const style = COMMENT_STYLES[Math.floor(Math.random() * COMMENT_STYLES.length)]

      try {
        const model = ctx.dbConfig?.model ?? await getVariable(ctx.workspaceId, 'engagement_model')
        const result = await generateSimpleText({
          model,
          systemPrompt: SYSTEM_PROMPT,
          userMessage: [
            `## CONTEXTO DA MARCA`,
            ctx.brandContext,
            '',
            `## PERFIL ALVO`,
            `Handle: @${handle}`,
            `Plataforma: ${platform}`,
            '',
            `## ESTILO SOLICITADO: ${style}`,
            this.describeStyle(style),
            '',
            `## TOPICOS RECENTES CURADOS (contexto do nosso nicho)`,
            topicContext.slice(0, 1200),
            '',
            `Gere um comentario inteligente como se estivesse respondendo a um post recente de @${handle}.`,
            `O comentario deve demonstrar expertise real e agregar valor a discussao.`,
          ].filter(Boolean).join('\n'),
          maxTokens: 300,
          temperature: ctx.dbConfig?.temperature ?? 0.8,
        })

        tokensUsed += result.tokensUsed

        // Parse the AI response
        let commentText: string
        let usedStyle: string = style
        try {
          const parsed = parseAIJson<GeneratedComment>(result.text, 'engagement-external')
          commentText = parsed.comment
          usedStyle = parsed.style ?? style
        } catch {
          // Fallback: use raw text if JSON parsing fails
          commentText = result.text.replace(/^["']|["']$/g, '').trim()
        }

        // Enforce max 2 sentences by truncating if needed
        const sentences = commentText.match(/[^.!?]+[.!?]+/g)
        if (sentences && sentences.length > 2) {
          commentText = sentences.slice(0, 2).join('').trim()
        }

        // Save engagement action with the resolved tweet URL
        try {
          await supabase.from('engagement_actions').insert({
            workspace_id: ctx.workspaceId,
            agent_slug: 'engagement-external',
            target_platform: platform,
            target_url: targetUrl,
            target_author: handle,
            action_type: 'comment' as const,
            comment_text: commentText,
            comment_style: usedStyle,
            status: 'pending',
            metadata: {
              engagement_profile_id: profile.id,
              style_requested: style,
              topics_context_count: topicsCount,
              target_tweet_id: targetTweetId,
              parent_tweet_id: parentTweetId,
              root_tweet_id: rootTweetId,
              conversation_id: conversationId,
              thread_id: threadId,
              pair_id: [ownPairHandle, normalizedHandle].filter(Boolean).sort().join(':'),
              guardrail: {
                version: 'v2',
                source: 'engagement_external',
                sameOwner: false,
              },
            },
          })

          engagementsCreated++
          generatedComments.push({
            handle,
            comment: commentText,
            style: usedStyle,
            platform,
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          errors.push(`Erro ao salvar engajamento para @${handle}: ${msg}`)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`Erro na geracao para @${handle}: ${msg}`)
      }
    }

    return {
      success: errors.length === 0,
      itemsProcessed: profilesChecked,
      itemsProduced: engagementsCreated,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.0000003,
      durationMs: Date.now() - startTime,
      details: {
        profilesChecked,
        profilesSkipped,
        sameOwnerSkipped,
        sameOwnerReconciled,
        engagementsCreated,
        topicsUsedForContext: topicsCount,
        generatedComments,
      },
    }
  }

  async evaluate(result: AgentResult): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    const ratio = result.itemsProcessed > 0
      ? result.itemsProduced / result.itemsProcessed
      : 0

    return {
      agentSlug: 'engagement-external',
      inputSummary: `${d.profilesChecked} profiles checked`,
      outputSummary: `${d.engagementsCreated} engagements created, ${d.profilesSkipped} skipped (limit)`,
      autoScore: ratio > 0.5 ? 8 : ratio > 0.2 ? 6 : 4,
      dimensions: {
        coverage: ratio > 0.5 ? 8 : 5,
        rateLimitRespect: 9,
        quality: result.itemsProduced > 0 ? 7 : 3,
        topicRelevance: (d.topicsUsedForContext as number) > 0 ? 8 : 4,
      },
      issues: result.errors,
      verdict: result.itemsProduced > 0 ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>

    if (!result.success && result.itemsProduced === 0) {
      return `\u274C *Engajador Externo* \u2014 Erro: ${result.errors[0] ?? 'desconhecido'}`
    }

    if (result.itemsProcessed === 0) {
      return '\uD83C\uDF10 *Engajador Externo* \u2014 Sem perfis ativos para engajar.'
    }

    const comments = (d.generatedComments as Array<{ handle: string; comment: string; style: string }>) ?? []
    const commentLines = comments.slice(0, 5).map(
      (c, i) => `  ${i + 1}. @${c.handle} [${c.style}] "${c.comment.slice(0, 70)}${c.comment.length > 70 ? '...' : ''}"`
    )

    const lines = [
      '\uD83C\uDF10 *Engajador Externo \u2014 Engajamento Completo*',
      '',
      `\uD83D\uDC64 Perfis verificados: ${d.profilesChecked}`,
      `\u2705 Engajamentos criados: ${d.engagementsCreated}`,
      `\u23ED Perfis no limite diario: ${d.profilesSkipped}`,
      `\uD83D\uDEE1\uFE0F Same-owner bloqueados: ${d.sameOwnerSkipped ?? 0}`,
      `\u267B\uFE0F Same-owner desativados: ${d.sameOwnerReconciled ?? 0}`,
      `\uD83D\uDCDA Topicos de contexto: ${d.topicsUsedForContext}`,
    ]

    if (commentLines.length > 0) {
      lines.push('', '\uD83D\uDCE8 *Comentarios gerados:*', ...commentLines)
    }

    lines.push(
      '',
      `\u23F1\uFE0F ${(result.durationMs / 1000).toFixed(1)}s | \uD83E\uDE99 ${result.tokensUsed} tokens`
    )

    if (result.errors.length > 0) {
      lines.push(`\u26A0\uFE0F Erros: ${result.errors.length}`)
    }

    return lines.join('\n')
  }

  private describeStyle(style: CommentStyle): string {
    const descriptions: Record<CommentStyle, string> = {
      opiniao_tecnica: 'Compartilhar uma opiniao tecnica embasada, citando dados concretos, benchmarks ou experiencia pratica de implementacao',
      complemento: 'Complementar o post com uma informacao adicional relevante — dado, paper, ou tendencia que o autor nao mencionou',
      pergunta: 'Fazer uma pergunta tecnica especifica que demonstre profundidade e gere discussao produtiva',
      elogio: 'Elogiar um ponto ESPECIFICO com contexto tecnico, explicando por que aquele ponto e importante',
    }
    return descriptions[style]
  }
}

export const agent = new EngagementExternalAgent()
