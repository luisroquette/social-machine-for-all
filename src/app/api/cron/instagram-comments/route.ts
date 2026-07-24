import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { isCronRequest } from '@/lib/api/auth'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { getVariable, getNumericVariable } from '@/lib/settings/load-settings'
import { generateTextWithFallback } from '@/lib/ai/generate-with-fallback'
import { isKeywordCta, classifyExternalError, isQuietHoursBRT } from '@/lib/platforms/instagram/webhook-utils'
import { findTrendGiveawayForMedia, TrendGiveawayContext, upsertGiveawayLead } from '@/lib/platforms/instagram/giveaway-leads'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const GRAPH_API = 'https://graph.facebook.com/v21.0'
const GRAPH_API_V24 = 'https://graph.facebook.com/v24.0'
const MAX_ATTEMPTS = 3
const BATCH = 5                  // reduzido (delays humanizados cabem no maxDuration=60s)
const DAILY_REPLY_CAP = 80       // anti-ban: default legado; override via workspace_settings.comment_daily_reply_cap
const TIME_BUDGET_MS = 50_000    // para o loop antes do timeout (evita item preso em 'processing')
const MIN_DELAY_MS = 2000        // spacing humanizado entre respostas
const MAX_DELAY_MS = 4000
const MEDIA_CONTEXT_CHARS = 900

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getAdminClient()
  const startTime = Date.now()

  // Anti-ban — quiet hours (23h–6h BRT): não responde de madrugada.
  if (isQuietHoursBRT(startTime)) {
    return NextResponse.json({ skipped: 'quiet_hours' })
  }

  // Media-mute durável: posts marcados (ex: reel viral que estourou a fila) NUNCA recebem
  // auto-reply. Lista por workspace em workspace_settings.autoreply_muted_media_ids (CSV).
  // Bulk-skip do pending desses media a cada run — fecha backlog E inflow futuro sem
  // whack-a-mole, e evita que comentários mutados afoguem a fila dos posts legítimos.
  const { data: muteRows } = await supabase
    .from('workspace_settings')
    .select('value')
    .eq('key', 'autoreply_muted_media_ids')
  const mutedMediaIds = [...new Set(
    (muteRows ?? []).flatMap((r: { value: string | null }) =>
      String(r.value ?? '').split(',').map(s => s.trim()).filter(Boolean))
  )]
  let mutedSkipped = 0
  if (mutedMediaIds.length) {
    const { count } = await supabase
      .from('instagram_comment_interactions')
      .update({ status: 'skipped', skip_reason: 'media_muted', processed_at: new Date().toISOString() }, { count: 'exact' })
      .eq('status', 'pending')
      .in('media_id', mutedMediaIds)
    mutedSkipped = count ?? 0
  }

  // Ignora itens em cooldown (skip_until no futuro). skip_until nulo ou vencido = elegível.
  const nowIso = new Date().toISOString()
  const { data: pending } = await supabase
    .from('instagram_comment_interactions')
    .select('*')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .or(`skip_until.is.null,skip_until.lte.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(BATCH)

  // Anti-ban — cap diário por workspace (contagem de respostas nas últimas 24h, cacheada).
  const repliedByWs = new Map<string, number>()
  const since24h = new Date(startTime - 24 * 60 * 60 * 1000).toISOString()
  async function repliesLast24h(ws: string): Promise<number> {
    if (repliedByWs.has(ws)) return repliedByWs.get(ws)!
    const { count } = await supabase
      .from('instagram_comment_interactions')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', ws)
      .eq('status', 'replied')
      .gte('processed_at', since24h)
    const n = count ?? 0
    repliedByWs.set(ws, n)
    return n
  }

  // Cap configurável por workspace. Ausência/valor inválido herda o default legado
  // (DAILY_REPLY_CAP) — nunca vira 0/desabilitado silenciosamente (Regra do Gate).
  const capByWs = new Map<string, number>()
  async function dailyCap(ws: string): Promise<number> {
    if (capByWs.has(ws)) return capByWs.get(ws)!
    const configured = await getNumericVariable(ws, 'comment_daily_reply_cap')
    const cap = configured > 0 ? configured : DAILY_REPLY_CAP
    capByWs.set(ws, cap)
    return cap
  }

  const results: Array<{ id: number; status: string; error?: string }> = []
  const giveawayByMediaId = new Map<string, TrendGiveawayContext | null>()

  for (const item of pending ?? []) {
    // Para antes do timeout — não deixa item preso em 'processing'.
    if (Date.now() - startTime > TIME_BUDGET_MS) break

    // Anti-ban — cap diário por workspace: se atingido, adia 1h (sem postar).
    if (await repliesLast24h(item.workspace_id) >= await dailyCap(item.workspace_id)) {
      await supabase
        .from('instagram_comment_interactions')
        .update({ skip_reason: 'daily_cap', skip_until: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
        .eq('id', item.id)
        .eq('status', 'pending')
      results.push({ id: item.id, status: 'skipped_daily_cap' })
      continue
    }

    // Claim atômico — evita processamento duplo em nudge + cron concorrentes
    const { data: claimed } = await supabase
      .from('instagram_comment_interactions')
      .update({ status: 'processing', attempts: (item.attempts ?? 0) + 1 })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id')

    if (!claimed?.length) {
      results.push({ id: item.id, status: 'skipped_claimed' })
      continue
    }

    let httpStatus: number | undefined
    let graphCode: number | undefined
    try {
      const [creds, brandName, igHandle] = await Promise.all([
        getInstagramCredentials(item.workspace_id),
        getVariable(item.workspace_id, 'brand_name'),
        getVariable(item.workspace_id, 'instagram_handle'),
      ])

      if (!creds.accessToken) throw new Error('missing_access_token')

      const mediaContext = await fetchMediaContext(creds.accessToken, item.media_id as string)
      const keywordCta = isKeywordCta(item.text as string)
      const giveawayContext = item.media_id
        ? (giveawayByMediaId.has(item.media_id)
            ? giveawayByMediaId.get(item.media_id) ?? null
            : await findTrendGiveawayForMedia(supabase, item.media_id))
        : null
      if (item.media_id && !giveawayByMediaId.has(item.media_id)) {
        giveawayByMediaId.set(item.media_id, giveawayContext)
      }

      // CTA (pedido de follow+DM em troca de link/conteúdo) SÓ faz sentido quando há
      // giveaway ativo pro media. `isKeywordCta` é só contagem de palavras (≤2), então
      // risada/emoji ("😂😂😂", "kkkk") num post viral SEM giveaway cairia no CTA e
      // pediria DM pra um link inexistente — spam off-brand + risco anti-ban. Sem
      // giveaway, comentário curto é tratado como comentário normal (resposta na voz da marca).
      const isGiveawayCta = keywordCta && !!giveawayContext

      const systemPrompt = buildSystemPrompt(brandName, igHandle)
      const contextBlock = buildContextBlock(igHandle, mediaContext)
      const userMessage = isGiveawayCta
        ? `Um seguidor usou a palavra-chave "${item.text}" num post do ${igHandle} que tinha um CTA pedindo esse comentário em troca de um link ou conteúdo exclusivo.\n` +
          `${contextBlock}\n` +
          `Seguidor: @${item.from_username ?? 'seguidor'}\n\n` +
          `Responda pedindo duas ações: (1) seguir o perfil ${igHandle} e (2) mandar uma DM. ` +
          `Varie o texto a cada resposta. Exemplos de tom (não copie exato): ` +
          `"Segue o perfil e me manda uma DM que eu te envio o link 🤙" ou ` +
          `"Me segue e solicita via DM que libero pra você!" ou ` +
          `"Boa! Segue ${igHandle} e me manda DM que envio direto 👊". ` +
          `1 frase curta, sem hashtags.`
        : `Um seguidor comentou em uma publicação do ${igHandle}.\n` +
          `${contextBlock}\n` +
          `Seguidor: @${item.from_username ?? 'seguidor'}\n` +
          `Comentário: "${item.text}"\n\n` +
          `Escreva a resposta.`

      const reply = (
        giveawayContext && keywordCta
          ? giveawayContext.commentReply
          : (await generateTextWithFallback({
              system: systemPrompt,
              prompt: userMessage,
              maxOutputTokens: 200,
              temperature: 0.8,
            })).replace(/^["']+|["']+$/g, '').trim()
      ).slice(0, 2000)
      if (!reply) throw new Error('empty_reply')

      // Posta via Graph API
      const body = new URLSearchParams({ message: reply, access_token: creds.accessToken })
      const resp = await fetch(`${GRAPH_API}/${item.comment_id}/replies`, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(30_000),
      })
      httpStatus = resp.status
      const data = await resp.json() as { id?: string; error?: { message: string; code: number } }

      if (!resp.ok || data.error) {
        graphCode = data.error?.code
        throw new Error(data.error?.message ?? `Graph API ${resp.status}`)
      }

      await supabase
        .from('instagram_comment_interactions')
        .update({
          status: 'replied',
          ai_reply: reply,
          reply_comment_id: data.id ?? null,
          processed_at: new Date().toISOString(),
          last_error: null,
          skip_reason: null,
          skip_until: null,
        })
        .eq('id', item.id)

      if (giveawayContext && keywordCta) {
        const repliedAt = new Date().toISOString()
        await upsertGiveawayLead({
          supabase,
          workspaceId: item.workspace_id,
          generatedContentId: giveawayContext.generatedContentId,
          trendVideoJobId: giveawayContext.trendVideoJobId,
          commentInteractionId: item.id,
          instagramMediaId: item.media_id,
          commenterIgUserId: item.from_id,
          commenterUsername: item.from_username,
          keyword: giveawayContext.keyword,
          commentText: item.text,
          status: 'comment_replied',
          repliedAt,
          commentReplyText: reply,
          followRequestedAt: repliedAt,
        })
      }

      repliedByWs.set(item.workspace_id, (repliedByWs.get(item.workspace_id) ?? 0) + 1)
      results.push({ id: item.id, status: 'replied' })

      // Spacing humanizado entre respostas (anti-ban): 2-4s.
      await new Promise(r => setTimeout(r, MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS)))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Falha de IA (generateTextWithFallback esgotou retry+fallback) não tem httpStatus/graphCode
      // do Graph API — usa o statusCode do erro do provider para classificar (Cláusula #10:
      // 429 → cooldown rate_limited, 5xx/timeout → cooldown unavailable, sem queimar tentativa).
      const aiStatus = typeof (e as Record<string, unknown>)?.statusCode === 'number'
        ? (e as { statusCode: number }).statusCode
        : undefined
      const kind = classifyExternalError({ status: httpStatus ?? aiStatus, graphCode, message: msg })

      if (kind !== 'permanent') {
        // Transiente (rate limit / indisponibilidade): cooldown em vez de queimar
        // tentativa. Desfaz o incremento do claim — transiente não conta como attempt.
        const cooldownMs = kind === 'rate_limited' ? 4 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000
        await supabase
          .from('instagram_comment_interactions')
          .update({
            status: 'pending',
            attempts: item.attempts ?? 0,
            skip_reason: kind === 'rate_limited' ? 'ig_rate_limited' : 'ig_unavailable',
            skip_until: new Date(Date.now() + cooldownMs).toISOString(),
            last_error: msg,
          })
          .eq('id', item.id)
        results.push({ id: item.id, status: `cooldown_${kind}`, error: msg })
      } else {
        const finalAttempts = (item.attempts ?? 0) + 1
        const finalStatus = finalAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
        await supabase
          .from('instagram_comment_interactions')
          .update({ status: finalStatus, last_error: msg })
          .eq('id', item.id)
        results.push({ id: item.id, status: finalStatus, error: msg })
      }
    }
  }

  return NextResponse.json({
    processed: results.length,
    replied: results.filter(r => r.status === 'replied').length,
    mutedSkipped,
    durationMs: Date.now() - startTime,
    results,
  })
}

function buildSystemPrompt(brandName: string, igHandle: string): string {
  const normalizedHandle = (igHandle || '').toLowerCase()
  const isbrand = normalizedHandle === '@brand.ia.br' || /brand\.ia/i.test(brandName)
  const isbrandmob = normalizedHandle === '@brand' || /brand/i.test(brandName)
  const tone = isbrand
    ? 'profissional, editorial, institucional e técnico. Fale com precisão jornalística, sem gírias excessivas.'
    : 'direto, sem hype e com humor seco'

  if (isbrandmob) {
    return (
      `Você é a equipe de comunicação da ${brandName} (${igHandle}), empresa de eletromobilidade.\n` +
      `Responda comentários no Instagram com tom formal, objetivo, claro e institucional, com foco em valor próprio da marca.\n` +
      `Você é consultivo, direto e persuasivo, porém sem exagero de marketing ou linguagem de meme.\n` +
      `Você responde em português brasileiro.\n` +
      `- 1 frase curta.\n` +
      `- Seja útil e relevante ao comentário e, quando possível, conecte com o contexto da publicação.\n` +
      `- Se fizer sentido, convide de forma natural a conhecer mais do trabalho da empresa e/ou produtos.\n` +
      `- Evite hashtags, promessas vagas e encerramentos genéricos como "segue @brand".\n` +
      `- Não invente informações técnicas, parcerias ou números.\n` +
      `- Não use emoji.\n` +
      `- Output: APENAS o texto da resposta, sem aspas, sem rótulos.`
    )
  }

  return (
    `Você é a voz do ${brandName} (${igHandle}), perfil de IA no Instagram que cobre ` +
    `notícias de inteligência artificial e tecnologia com tom ${tone}.\n` +
    `Você responde comentários de seguidores em português brasileiro.\n` +
    `- 1-2 frases, natural, como uma pessoa real — não um bot.\n` +
    `- Seja relevante ao que o seguidor disse.\n` +
    `- Quando encaixar naturalmente, convide a seguir ${igHandle} para mais conteúdo diário de IA.\n` +
    `- Sem hashtags. No máximo um emoji. Sem enchimento como "Ótima pergunta!".\n` +
    `- Baseie a resposta no contexto da publicação quando disponível; se não houver contexto, responda apenas ao comentário.\n` +
    `- Output: APENAS o texto da resposta, sem aspas, sem rótulos.`
  )
}

interface MediaContext {
  caption: string
  permalink?: string
  mediaType?: string
  altText?: string
}

function buildContextBlock(igHandle: string, mediaContext: MediaContext | null): string {
  if (!mediaContext) {
    return `Contexto da publicação: não disponível.\nNão invente informações da postagem.`
  }

  const caption = mediaContext.caption.trim() || mediaContext.altText?.trim() || 'não disponível'
  const clippedCaption = caption.length > MEDIA_CONTEXT_CHARS
    ? `${caption.slice(0, MEDIA_CONTEXT_CHARS)}...`
    : caption

  const mediaLine = mediaContext.mediaType ? `Formato: ${mediaContext.mediaType}. ` : ''
  const linkLine = mediaContext.permalink ? `\nLink da publicação: ${mediaContext.permalink}` : ''

  return `Contexto da publicação em ${igHandle}:\n${mediaLine}Legenda: "${clippedCaption}"${linkLine}`
}

async function fetchMediaContext(accessToken: string, mediaId: string | null): Promise<MediaContext | null> {
  if (!accessToken || !mediaId) return null

  const params = new URLSearchParams({
    fields: 'caption,media_type,permalink,alt_text',
    access_token: accessToken,
  })

  try {
    const resp = await fetch(`${GRAPH_API_V24}/${mediaId}?${params.toString()}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return null
    const data = await resp.json() as {
      caption?: string
      media_type?: string
      permalink?: string
      alt_text?: string
      error?: { message: string }
    }
    const caption = data.caption?.trim()
    const altText = data.alt_text?.trim()
    if (!caption && !altText && !data.media_type && !data.permalink) return null
    return {
      caption: caption ?? altText ?? '',
      mediaType: data.media_type,
      permalink: data.permalink,
      altText,
    }
  } catch {
    return null
  }
}
