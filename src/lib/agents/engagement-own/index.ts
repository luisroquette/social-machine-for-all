import { BaseAgent } from '../base-agent'
import type { AgentConfig, AgentResult, RunContext, EvalEntry } from '../agent-types'
import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable, loadSettings } from '@/lib/settings/load-settings'
import { searchTweetsIO } from '@/lib/platforms/x/twitterapi-io'
import { assessNovelty, buildThreadMemory, decideGuardrailAction, parseHandleList, resolveThreadId } from './loop-guardrails'
import { BUILTIN_OWNED_X_HANDLES } from '@/lib/engagement-profiles/same-owner'

const REPLY_STYLES = ['complemento', 'pergunta', 'debate', 'agradecimento'] as const
type ReplyStyle = (typeof REPLY_STYLES)[number]

interface GeneratedReply {
  reply: string
  style: ReplyStyle
}

interface RecentGuardrailAction {
  created_at: string | null
  executed_at: string | null
  status: string | null
  comment_text: string | null
  metadata: Record<string, unknown> | null
  target_author: string | null
}

interface GuardrailMetadata {
  thread_id?: string
  pair_id?: string
  conversation_id?: string | null
  root_tweet_id?: string | null
  target_tweet_id?: string | null
  parent_tweet_id?: string | null
  in_reply_to_username?: string | null
  guardrail?: {
    version?: string
    hasNovelty?: boolean
  }
}

interface SuppressedReply {
  tweetId: string
  author: string
  action: 'block' | 'cooldown' | 'allow_if_strong_novelty'
  loopScore: number
  reasons: string[]
}

function normalizeHandle(value: string | null | undefined): string {
  return (value ?? '').replace('@', '').trim().toLowerCase()
}

function readGuardrailMetadata(metadata: Record<string, unknown> | null): GuardrailMetadata {
  if (!metadata || typeof metadata !== 'object') return {}
  return metadata as GuardrailMetadata
}

function buildSystemPrompt(ownHandle: string): string {
  return `Voce representa @${ownHandle}. Use somente o contexto de marca fornecido.
Tom: pragmatico, tecnico e direto.

MISSAO: Responder comentarios que TERCEIROS fizeram nas suas postagens. Seu objetivo e manter a conversa viva e aumentar engajamento organico.

## REGRAS INVIOLAVEIS
1. Maximo 2 frases. Sem excecoes.
2. NUNCA respostas genericas ("obrigado!", "otimo ponto!", "valeu!").
3. SEMPRE referencie algo ESPECIFICO do comentario da pessoa.
4. Portugues brasileiro, tom profissional mas acessivel.
5. A resposta deve agregar valor: dado presente no post original, perspectiva baseada no que foi publicado, ou pergunta que aprofunde o tema do post. NUNCA invente dados, metricas ou fatos que nao estejam no post ou comentario. Se nao houver nada concreto para adicionar, use o estilo "pergunta" em vez de inventar.
5b. Se o comentario for generico demais para gerar resposta de qualidade, retorne: {"reply": null, "style": "skip"}
6. NUNCA mencione que voce e uma IA ou sistema automatizado.

## ESTILOS
- agradecimento: agradecer mencionando o ponto exato + novo dado/contexto
- complemento: adicionar dado/insight que o comentario nao cobriu
- pergunta: pergunta inteligente que aprofunde o debate
- debate: contraponto respeitoso com dados concretos

Responda APENAS com JSON:
{"reply": "texto da resposta", "style": "estilo_usado"}
`
}

export function isKeywordCta(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed.split(/\s+/).length <= 2
}

class EngagementOwnAgent extends BaseAgent {
  get config(): AgentConfig {
    return {
      slug: 'engagement-own',
      name: 'Engajador Proprio',
      role: 'engagement',
      description: 'Responde comentarios de terceiros nas nossas postagens, retuita e curte conteudo externo relevante',
      defaultModel: 'deepseek-chat',
      pipelineStage: 6,
      maxActionsPerHour: 20,
      quietHours: { start: 0, end: 8 },
    }
  }

  async execute(ctx: RunContext): Promise<AgentResult> {
    const supabase = getAdminClient()
    const settings = await loadSettings(ctx.workspaceId)
    const ownHandle = settings.own_twitter_handle
    const startTime = Date.now()
    let tokensUsed = 0
    let engagementsCreated = 0
    const errors: string[] = []
    const generatedReplies: Array<{ tweetId: string; reply: string; style: string }> = []
    const suppressedReplies: SuppressedReply[] = []

    // 1. Fetch real replies from THIRD PARTIES to our posts
    let replies: NonNullable<Awaited<ReturnType<typeof searchTweetsIO>>> = []
    try {
      replies = (await searchTweetsIO(
        `to:${ownHandle} -from:${ownHandle} -is:retweet (lang:pt OR lang:und)`,
        15,
        'Latest'
      )) ?? []
    } catch (err) {
      errors.push(`Erro ao buscar replies: ${err instanceof Error ? err.message : String(err)}`)
    }

    const normalizedOwn = ownHandle.replace('@', '').toLowerCase()
    const [primaryTwitterHandle, ownedHandlesCsv, knownAgentHandlesCsv] = await Promise.all([
      getVariable(ctx.workspaceId, 'twitter_handle'),
      getVariable(ctx.workspaceId, 'owned_x_handles'),
      getVariable(ctx.workspaceId, 'known_agent_x_handles'),
    ])
    const ownedHandles = parseHandleList(
      ownHandle,
      settings.target_handle,
      primaryTwitterHandle,
      ownedHandlesCsv,
      BUILTIN_OWNED_X_HANDLES.join(','),
    )
    const knownAgentHandles = parseHandleList(knownAgentHandlesCsv)
    knownAgentHandles.delete(normalizedOwn)

    const replyAuthors = Array.from(new Set(
      replies
        .map(reply => normalizeHandle(reply.author))
        .filter(author => author && author !== normalizedOwn)
    ))

    const recentActionsByAuthor = new Map<string, RecentGuardrailAction[]>()
    if (replyAuthors.length > 0) {
      try {
        const lookbackISO = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString()
        const { data: recentActions } = await supabase
          .from('engagement_actions')
          .select('created_at, executed_at, status, comment_text, metadata, target_author')
          .eq('workspace_id', ctx.workspaceId)
          .eq('agent_slug', 'engagement-own')
          .in('target_author', replyAuthors)
          .gte('created_at', lookbackISO)
          .order('created_at', { ascending: false })
          .limit(60)

        for (const action of (recentActions ?? []) as RecentGuardrailAction[]) {
          const author = normalizeHandle(action.target_author)
          if (!author) continue
          const items = recentActionsByAuthor.get(author) ?? []
          items.push(action)
          recentActionsByAuthor.set(author, items)
        }
      } catch {
        // Guardrail history is best-effort. Engagement should not hard fail on telemetry gaps.
      }
    }

    const recentReplyEvents = replies
      .filter(reply => reply.id && reply.text)
      .map(reply => ({
        id: String(reply.id),
        author: normalizeHandle(reply.author),
        text: String(reply.text),
        createdAt: reply.createdAt ?? new Date().toISOString(),
        threadId: resolveThreadId({
          conversationId: reply.conversationId ?? null,
          currentReplyId: String(reply.id),
        }),
      }))
      .filter(reply => reply.author && reply.author !== normalizedOwn)

    for (const reply of replies) {
      if (!reply.id || !reply.text) continue

      // GUARDRAIL PERMANENTE: nunca engajar com tweets do próprio account
      // Dupla verificação: author field + URL — imune ao decay do feedback loop
      const replyAuthor = (reply.author ?? '').replace('@', '').toLowerCase()
      const replyUrl = (reply.url ?? '').toLowerCase()
      if (replyAuthor === normalizedOwn) continue
      if (replyUrl.includes(`/${normalizedOwn}/`)) continue
      const conversationId = reply.conversationId ?? null
      const targetTweetId = String(reply.id)
      const parentTweetId = reply.inReplyToId ?? null
      const rootTweetId = conversationId ?? targetTweetId
      const threadId = resolveThreadId({
        conversationId,
        rootTweetId,
        currentReplyId: targetTweetId,
      })

      const threadMemory = buildThreadMemory({
        ownHandle,
        replyAuthor,
        currentReplyId: targetTweetId,
        threadId,
        recentPairActions: (recentActionsByAuthor.get(replyAuthor) ?? [])
          .filter(action => {
            const metadata = readGuardrailMetadata(action.metadata)
            if (metadata.thread_id) return metadata.thread_id === threadId
            if (metadata.conversation_id) return metadata.conversation_id === conversationId
            return true
          })
          .map(action => ({
          createdAt: action.created_at,
          executedAt: action.executed_at,
          status: action.status,
          commentText: action.comment_text,
          metadata: action.metadata,
        })),
        recentReplies: recentReplyEvents.slice(-12),
      })

      if (ownedHandles.has(replyAuthor)) {
        suppressedReplies.push({
          tweetId: reply.id,
          author: replyAuthor,
          action: 'block',
          loopScore: 1,
          reasons: ['same_owner', 'preflight_block'],
        })
        continue
      }

      // Dedup: skip if we already enqueued any action for this comment.
      // Match pelo ID do tweet (sufixo `/status/{id}`) — robusto às variações de
      // formato de URL que aparecem na prática: `x.com/{user}/status/{id}`,
      // `x.com/i/status/{id}` e `x.com/i/web/status/{id}`. Usar a URL completa
      // quebrava o dedup porque a query usava um formato e o insert gravava outro,
      // fazendo o agente re-responder o mesmo comentário a cada run do cron.
      try {
        const { count } = await supabase
          .from('engagement_actions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ctx.workspaceId)
          .ilike('target_url', `%/status/${reply.id}`)

        if ((count ?? 0) > 0) continue
      } catch { /* ignore dedup errors */ }

      if (isKeywordCta(reply.text)) {
        const ctas = [
          `Segue o perfil e me manda uma DM que eu te envio! 👊`,
          `Me segue e solicita via DM que libero pra você 🤙`,
          `Boa! Segue @${ownHandle} e me manda DM que envio direto 👇`,
          `Segue aqui e me manda DM que te mando o link 🔗`,
        ]
        const ctaReply = ctas[Math.floor(Math.random() * ctas.length)]
        const novelty = assessNovelty({
          candidateReply: ctaReply,
          originalReplyText: reply.text,
          recentOwnReplies: (recentActionsByAuthor.get(replyAuthor) ?? []).map(action => action.comment_text ?? ''),
        })
        const decision = decideGuardrailAction({
          memory: threadMemory,
          novelty,
          counterpartyHandle: replyAuthor,
          ownedHandles,
          knownAgentHandles,
        })
        if (decision.action !== 'allow') {
          suppressedReplies.push({
            tweetId: reply.id,
            author: replyAuthor,
            action: decision.action,
            loopScore: decision.loopScore,
            reasons: decision.reasons.concat(novelty.reasons),
          })
          continue
        }
        const url = reply.url ?? `https://x.com/i/web/status/${reply.id}`
        const metadata = {
          source: 'keyword_cta',
          original_reply_id: targetTweetId,
          target_tweet_id: targetTweetId,
          parent_tweet_id: parentTweetId,
          root_tweet_id: rootTweetId,
          conversation_id: conversationId,
          thread_id: threadMemory.threadId,
          pair_id: threadMemory.pairId,
          thread_key: threadMemory.threadKey,
          counterparty_handle: replyAuthor,
          in_reply_to_username: reply.inReplyToUsername ?? null,
          guardrail: {
            version: 'v2',
            action: decision.action,
            loopScore: decision.loopScore,
            sameOwner: decision.sameOwner,
            knownAgent: decision.knownAgent,
            hasNovelty: novelty.useful,
            noveltyScore: novelty.score,
            reasons: decision.reasons.concat(novelty.reasons),
            metrics: {
              alternationStreak: threadMemory.turnAlternationStreak,
              pairDominance: threadMemory.pairDominance,
              recentPairTurns: threadMemory.recentPairTurns,
              recentOwnReplies: threadMemory.recentOwnReplies,
              recentThirdPartyReplies: threadMemory.recentThirdPartyReplies,
              trailingLowNoveltyStreak: threadMemory.trailingLowNoveltyStreak,
            },
          },
        }
        await supabase.from('engagement_actions').insert({
          workspace_id: ctx.workspaceId,
          agent_slug: 'engagement-own',
          target_platform: 'x',
          target_url: url,
          target_author: replyAuthor,
          action_type: 'comment',
          comment_text: ctaReply,
          comment_style: 'cta',
          status: 'pending',
          metadata,
        })
        engagementsCreated += 1
        generatedReplies.push({ tweetId: reply.id, reply: ctaReply, style: 'cta' })
        const items = recentActionsByAuthor.get(replyAuthor) ?? []
        items.push({
          created_at: new Date().toISOString(),
          executed_at: null,
          status: 'pending',
          comment_text: ctaReply,
          metadata,
          target_author: replyAuthor,
        })
        recentActionsByAuthor.set(replyAuthor, items)
        continue
      }

      const style = REPLY_STYLES[Math.floor(Math.random() * REPLY_STYLES.length)]

      try {
        const model = ctx.dbConfig?.model ?? await getVariable(ctx.workspaceId, 'engagement_model')
        const result = await generateSimpleText({
          model,
          systemPrompt: buildSystemPrompt(ownHandle),
          userMessage: [
            `## CONTEXTO DA MARCA`,
            ctx.brandContext ?? '',
            '',
            `## COMENTARIO DO TERCEIRO (responda a este):`,
            reply.text,
            '',
            `Estilo solicitado: ${style}`,
          ].join('\n'),
          maxTokens: 200,
          temperature: 0.8,
        })

        tokensUsed += result.tokensUsed

        let replyText: string
        try {
          const parsed = parseAIJson<GeneratedReply>(result.text, 'engagement-own')
          replyText = parsed.reply
        } catch {
          replyText = result.text.replace(/^["']|["']$/g, '').trim()
        }

        if (!replyText || replyText.length < 5) continue

        // Truncate to 2 sentences
        const sentences = replyText.match(/[^.!?]+[.!?]+/g)
        if (sentences && sentences.length > 2) {
          replyText = sentences.slice(0, 2).join('').trim()
        }

        const url = reply.url ?? `https://x.com/i/web/status/${reply.id}`
        const novelty = assessNovelty({
          candidateReply: replyText,
          originalReplyText: reply.text,
          recentOwnReplies: (recentActionsByAuthor.get(replyAuthor) ?? []).map(action => action.comment_text ?? ''),
        })
        const decision = decideGuardrailAction({
          memory: threadMemory,
          novelty,
          counterpartyHandle: replyAuthor,
          ownedHandles,
          knownAgentHandles,
        })

        if (decision.action === 'cooldown' || decision.action === 'block') {
          suppressedReplies.push({
            tweetId: reply.id,
            author: replyAuthor,
            action: decision.action,
            loopScore: decision.loopScore,
            reasons: decision.reasons.concat(novelty.reasons),
          })
          continue
        }

        if (decision.action === 'allow_if_strong_novelty' && !novelty.strong) {
          suppressedReplies.push({
            tweetId: reply.id,
            author: replyAuthor,
            action: decision.action,
            loopScore: decision.loopScore,
            reasons: decision.reasons.concat(novelty.reasons, ['novelty_not_strong_enough']),
          })
          continue
        }

        const replyMetadata = {
          source: 'reply_to_commenter',
          original_reply_id: targetTweetId,
          target_tweet_id: targetTweetId,
          parent_tweet_id: parentTweetId,
          root_tweet_id: rootTweetId,
          conversation_id: conversationId,
          thread_id: threadMemory.threadId,
          pair_id: threadMemory.pairId,
          thread_key: threadMemory.threadKey,
          counterparty_handle: replyAuthor,
          in_reply_to_username: reply.inReplyToUsername ?? null,
          guardrail: {
            version: 'v2',
            action: decision.action,
            loopScore: decision.loopScore,
            sameOwner: decision.sameOwner,
            knownAgent: decision.knownAgent,
            hasNovelty: novelty.useful,
            noveltyScore: novelty.score,
            reasons: decision.reasons.concat(novelty.reasons),
            metrics: {
              alternationStreak: threadMemory.turnAlternationStreak,
              pairDominance: threadMemory.pairDominance,
              recentPairTurns: threadMemory.recentPairTurns,
              recentOwnReplies: threadMemory.recentOwnReplies,
              recentThirdPartyReplies: threadMemory.recentThirdPartyReplies,
              trailingLowNoveltyStreak: threadMemory.trailingLowNoveltyStreak,
            },
          },
        }

        // Queue: comment reply to the third-party comment
        await supabase.from('engagement_actions').insert({
          workspace_id: ctx.workspaceId,
          agent_slug: 'engagement-own',
          target_platform: 'x',
          target_url: url,
          target_author: replyAuthor,
          action_type: 'comment',
          comment_text: replyText,
          comment_style: style,
          status: 'pending',
          metadata: replyMetadata,
        })

        // Also like the commenter's tweet
        await supabase.from('engagement_actions').insert({
          workspace_id: ctx.workspaceId,
          agent_slug: 'engagement-own',
          target_platform: 'x',
          target_url: url,
          target_author: replyAuthor,
          action_type: 'like',
          comment_text: null,
          comment_style: null,
          status: 'pending',
          metadata: {
            source: 'like_commenter',
            original_reply_id: targetTweetId,
            target_tweet_id: targetTweetId,
            parent_tweet_id: parentTweetId,
            root_tweet_id: rootTweetId,
            conversation_id: conversationId,
            thread_id: threadMemory.threadId,
            pair_id: threadMemory.pairId,
            thread_key: threadMemory.threadKey,
            counterparty_handle: replyAuthor,
            in_reply_to_username: reply.inReplyToUsername ?? null,
            guardrail: replyMetadata.guardrail,
          },
        })

        engagementsCreated += 2
        generatedReplies.push({ tweetId: reply.id, reply: replyText, style })
        const items = recentActionsByAuthor.get(replyAuthor) ?? []
        items.push({
          created_at: new Date().toISOString(),
          executed_at: null,
          status: 'pending',
          comment_text: replyText,
          metadata: replyMetadata,
          target_author: replyAuthor,
        })
        recentActionsByAuthor.set(replyAuthor, items)
      } catch (err) {
        errors.push(`Erro ao processar reply ${reply.id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // 2. Queue retweets for high-engagement external content (from engagement-external queue)
    // Scan recent top tweets from followed topics to retweet
    try {
      const topTweets = (await searchTweetsIO(
        `(AI OR "machine learning" OR LLM OR "Claude" OR "GPT") lang:en -is:retweet min_faves:500`,
        5,
        'Top'
      )) ?? []

      for (const tweet of topTweets) {
        if (!tweet.id) continue

        // GUARDRAIL PERMANENTE: nunca retweetar próprio conteúdo
        // Dupla verificação: author field + URL + aliases da operação
        const tweetAuthor = (tweet.author ?? '').replace('@', '').toLowerCase()
        const tweetUrl = (tweet.url ?? '').toLowerCase()
        if (tweetAuthor === normalizedOwn) continue
        if (tweetUrl.includes(`/${normalizedOwn}/`)) continue
        if (tweetAuthor && ownedHandles.has(tweetAuthor)) continue
        if (Array.from(ownedHandles).some(handle => tweetUrl.includes(`/${handle}/`))) continue

        const { count } = await supabase
          .from('engagement_actions')
          .select('id', { count: 'exact', head: true })
          .eq('workspace_id', ctx.workspaceId)
          .eq('action_type', 'retweet')
          .eq('target_url', tweet.url ?? `https://x.com/i/status/${tweet.id}`)

        if ((count ?? 0) > 0) continue

        await supabase.from('engagement_actions').insert({
          workspace_id: ctx.workspaceId,
          agent_slug: 'engagement-own',
          target_platform: 'x',
          target_url: tweet.url ?? `https://x.com/i/status/${tweet.id}`,
          target_author: tweet.author ?? null,
          action_type: 'retweet',
          comment_text: null,
          comment_style: null,
          status: 'pending',
          metadata: { source: 'retweet_external', likes: tweet.metrics?.likes },
        })

        engagementsCreated++
      }
    } catch (err) {
      errors.push(`Erro ao buscar conteudo para retweet: ${err instanceof Error ? err.message : String(err)}`)
    }

    return {
      success: errors.length === 0 || engagementsCreated > 0,
      itemsProcessed: replies.length,
      itemsProduced: engagementsCreated,
      errors,
      tokensUsed,
      costEstimate: tokensUsed * 0.0000003,
      durationMs: Date.now() - startTime,
      details: {
        repliesFound: replies.length,
        engagementsCreated,
        guardrailSkipped: suppressedReplies.length,
        generatedReplies,
        suppressedReplies,
      },
    }
  }

  async evaluate(result: AgentResult): Promise<EvalEntry> {
    const d = result.details as Record<string, unknown>
    return {
      agentSlug: 'engagement-own',
      inputSummary: `${d.repliesFound} replies encontrados`,
      outputSummary: `${d.engagementsCreated} engajamentos criados`,
      autoScore: result.itemsProduced > 0 ? 8 : 5,
      dimensions: { coverage: 7, variety: 8, quality: 7 },
      issues: result.errors,
      verdict: result.itemsProduced > 0 ? 'keep' : 'improve',
    }
  }

  override formatTelegramReport(result: AgentResult): string {
    const d = result.details as Record<string, unknown>
    const replies = (d.generatedReplies as Array<{ tweetId: string; reply: string; style: string }>) ?? []
    const lines = [
      '💬 *Engajador Proprio — Engajamento Completo*',
      '',
      `🔍 Replies de terceiros encontrados: ${d.repliesFound}`,
      `✅ Engajamentos criados: ${d.engagementsCreated}`,
      `🛡️ Replies barrados pelo guardrail: ${d.guardrailSkipped ?? 0}`,
    ]
    if (replies.length > 0) {
      lines.push('', '📨 *Respostas geradas:*')
      replies.slice(0, 3).forEach((r, i) => {
        lines.push(`  ${i + 1}. [${r.style}] "${r.reply.slice(0, 80)}..."`)
      })
    }
    lines.push('', `⏱️ ${(result.durationMs / 1000).toFixed(1)}s | 🪙 ${result.tokensUsed} tokens`)
    return lines.join('\n')
  }
}

export const agent = new EngagementOwnAgent()
