/**
 * Utilitários puros para webhook de comentários do Instagram.
 * Runtime-agnóstico: Web Crypto (globalThis.crypto) disponível em Node.js 18+ e edge.
 */

export interface IgComment {
  comment_id: string
  media_id: string | null
  parent_id: string | null
  from_id: string
  from_username: string | null
  text: string
}

export interface IgMessage {
  message_id: string
  from_id: string
  to_id: string | null
  text: string
}

/**
 * Valida o header X-Hub-Signature-256 enviado pela Meta.
 * Timing-safe: nunca vaza se o tamanho bate ou não.
 */
export async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader?.startsWith('sha256=') || !appSecret) return false
  const expected = signatureHeader.slice(7).trim().toLowerCase()
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody))
  const actual = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('')
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

/**
 * Extrai todos os comentários do payload de webhook.
 * Retorna apenas os entries que batem com igUserId (roteamento multi-conta).
 */
export function extractComments(payload: unknown, igUserId?: string): IgComment[] {
  const out: IgComment[] = []
  const p = payload as {
    entry?: Array<{
      id?: string
      changes?: Array<{ field?: string; value?: Record<string, unknown> }>
    }>
  }
  for (const entry of p?.entry ?? []) {
    if (igUserId && entry.id && entry.id !== igUserId) continue
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'comments') continue
      const v = change.value ?? {}
      if (!v.id) continue
      const from = v.from as { id?: string; username?: string } | undefined
      out.push({
        comment_id: String(v.id),
        media_id: (v.media as { id?: string } | undefined)?.id
          ? String((v.media as { id: string }).id)
          : null,
        parent_id: v.parent_id ? String(v.parent_id) : null,
        from_id: from?.id ? String(from.id) : '',
        from_username: from?.username ?? null,
        text: typeof v.text === 'string' ? v.text : '',
      })
    }
  }
  return out
}

/**
 * Extrai DMs do payload de webhook do Instagram.
 * Suporta formatos `entry.messaging[]` e `changes[field=messages]`.
 */
export function extractMessages(payload: unknown, igUserId?: string): IgMessage[] {
  const out: IgMessage[] = []
  const p = payload as {
    entry?: Array<{
      id?: string
      messaging?: Array<{
        sender?: { id?: string }
        recipient?: { id?: string }
        message?: { mid?: string; text?: string; is_echo?: boolean }
      }>
      changes?: Array<{ field?: string; value?: Record<string, unknown> }>
    }>
  }

  for (const entry of p?.entry ?? []) {
    if (igUserId && entry.id && entry.id !== igUserId) continue

    for (const event of entry.messaging ?? []) {
      const text = event.message?.text?.trim() ?? ''
      const messageId = event.message?.mid ? String(event.message.mid) : ''
      const fromId = event.sender?.id ? String(event.sender.id) : ''
      const isEcho = event.message?.is_echo === true
      if (isEcho || !messageId || !fromId || !text) continue
      out.push({
        message_id: messageId,
        from_id: fromId,
        to_id: event.recipient?.id ? String(event.recipient.id) : null,
        text,
      })
    }

    for (const change of entry.changes ?? []) {
      if (change?.field !== 'messages') continue
      const value = change.value ?? {}
      const message = value.message as { mid?: string; text?: string; is_echo?: boolean } | undefined
      const from = value.from as { id?: string } | undefined
      const to = value.to as { id?: string } | undefined
      const text = message?.text?.trim() ?? ''
      const messageId = message?.mid ? String(message.mid) : ''
      const fromId = from?.id ? String(from.id) : ''
      if (message?.is_echo === true || !messageId || !fromId || !text) continue
      out.push({
        message_id: messageId,
        from_id: fromId,
        to_id: to?.id ? String(to.id) : null,
        text,
      })
    }
  }

  return out
}

/**
 * Anti-eco: evita responder o próprio comentário (causaria loop webhook→reply→webhook).
 */
export function shouldSkip(
  comment: IgComment,
  ourUserId: string,
): { skip: boolean; reason?: string } {
  if (comment.from_id && ourUserId && comment.from_id === ourUserId)
    return { skip: true, reason: 'self_comment' }
  if (!comment.text?.trim()) return { skip: true, reason: 'empty_text' }
  return { skip: false }
}

/**
 * Keyword CTA: comentário curto (≤2 palavras) é provavelmente um trigger de CTA
 * ("MINI", "INFO", "LINK", "SIM"...) e não uma conversa. A resposta deve pedir
 * follow + DM em vez de tentar conversar. Texto vazio não é CTA (e nem chega ao
 * worker, pois `shouldSkip` já o filtra).
 */
export function isKeywordCta(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  return t.split(/\s+/).length <= 2
}

/**
 * Classifica um erro externo (Graph API ou LLM) ao postar a resposta, para decidir
 * entre cooldown (transiente) e falha permanente — espelha a cláusula pétrea #10.
 *
 * - `rate_limited`: HTTP 429 ou código de rate-limit da Meta (4/17/32/613) → cooldown longo.
 * - `unavailable`: HTTP 5xx ou timeout/rede → cooldown curto.
 * - `permanent`: 4xx (ex: token expirado #190, 400/403) → conta tentativa, falha ao esgotar.
 */
export function classifyExternalError(
  opts: { status?: number; graphCode?: number; message?: string },
): 'rate_limited' | 'unavailable' | 'permanent' {
  const { status, graphCode } = opts
  const msg = opts.message ?? ''
  if (graphCode != null && [4, 17, 32, 613].includes(graphCode)) return 'rate_limited'
  if (status === 429) return 'rate_limited'
  if (status != null && status >= 500) return 'unavailable'
  if (/timeout|timed out|abort|network|fetch failed|ETIMEDOUT|ECONNRESET|socket/i.test(msg)) return 'unavailable'
  if (/\b429\b|rate.?limit/i.test(msg)) return 'rate_limited'
  if (/\b5\d\d\b/.test(msg)) return 'unavailable'
  return 'permanent'
}

/**
 * Quiet hours anti-ban: não responder comentários de madrugada (parece bot e tem
 * baixo alcance). Janela padrão 23h–6h no fuso BRT (UTC-3). `nowMs` é injetado
 * para testabilidade. Suporta janela que cruza a meia-noite.
 */
export function isQuietHoursBRT(nowMs: number, startBrt = 23, endBrt = 6): boolean {
  const brtHour = (new Date(nowMs).getUTCHours() - 3 + 24) % 24
  return startBrt > endBrt
    ? (brtHour >= startBrt || brtHour < endBrt)
    : (brtHour >= startBrt && brtHour < endBrt)
}

/**
 * Responde ao handshake GET da Meta (verificação do webhook).
 */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  const mode = params.get('hub.mode')
  const token = params.get('hub.verify_token')
  const challenge = params.get('hub.challenge')
  return mode === 'subscribe' && verifyToken && token === verifyToken && challenge ? challenge : null
}
