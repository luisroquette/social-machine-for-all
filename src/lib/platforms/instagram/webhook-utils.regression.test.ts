/**
 * REGRESSÃO: webhook-utils — validação de assinatura, anti-eco, roteamento, handshake
 */

import { describe, it, expect } from 'vitest'
import { verifySignature, extractComments, extractMessages, shouldSkip, verifyChallenge, isKeywordCta, classifyExternalError, isQuietHoursBRT } from './webhook-utils'

async function sign(body: string, secret: string): Promise<string> {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const buf = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return 'sha256=' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

const BODY = JSON.stringify({ entry: [] })
const SECRET = 'test_app_secret'

describe('REGRESSÃO: verifySignature', () => {
  it('assinatura válida passa', async () => {
    expect(await verifySignature(BODY, await sign(BODY, SECRET), SECRET)).toBe(true)
  })

  it('body alterado falha', async () => {
    expect(await verifySignature(BODY + 'x', await sign(BODY, SECRET), SECRET)).toBe(false)
  })

  it('header null retorna false (fail-closed)', async () => {
    expect(await verifySignature(BODY, null, SECRET)).toBe(false)
  })

  it('sem prefixo sha256= retorna false', async () => {
    const bare = (await sign(BODY, SECRET)).replace('sha256=', '')
    expect(await verifySignature(BODY, bare, SECRET)).toBe(false)
  })
})

describe('REGRESSÃO: shouldSkip', () => {
  const c = { comment_id: 'c1', media_id: null, parent_id: null, from_id: 'OUR_ID', from_username: 'us', text: 'hi' }

  it('auto-comentário é pulado (anti-eco)', () => {
    expect(shouldSkip(c, 'OUR_ID')).toEqual({ skip: true, reason: 'self_comment' })
  })

  it('comentário de terceiro passa', () => {
    expect(shouldSkip({ ...c, from_id: 'OTHER_ID' }, 'OUR_ID').skip).toBe(false)
  })

  it('texto vazio é pulado', () => {
    expect(shouldSkip({ ...c, from_id: 'X', text: '   ' }, 'OUR_ID')).toEqual({ skip: true, reason: 'empty_text' })
  })
})

describe('REGRESSÃO: extractComments', () => {
  it('ignora fields que não são comments', () => {
    const payload = { entry: [{ changes: [{ field: 'mentions', value: { id: 'x' } }] }] }
    expect(extractComments(payload)).toHaveLength(0)
  })

  it('extrai comentário do campo comments', () => {
    const payload = {
      entry: [{ changes: [{ field: 'comments', value: { id: 'c1', from: { id: 'u1', username: 'alice' }, text: 'oi' } }] }],
    }
    const result = extractComments(payload)
    expect(result).toHaveLength(1)
    expect(result[0].comment_id).toBe('c1')
    expect(result[0].from_username).toBe('alice')
  })

  it('filtra por igUserId (roteamento multi-conta)', () => {
    const payload = {
      entry: [
        { id: 'ACC_A', changes: [{ field: 'comments', value: { id: 'c1', from: { id: 'u' }, text: 'hi' } }] },
        { id: 'ACC_B', changes: [{ field: 'comments', value: { id: 'c2', from: { id: 'u' }, text: 'hey' } }] },
      ],
    }
    const forA = extractComments(payload, 'ACC_A')
    expect(forA).toHaveLength(1)
    expect(forA[0].comment_id).toBe('c1')
  })

  it('payload vazio retorna array vazio sem erro', () => {
    expect(extractComments({})).toHaveLength(0)
    expect(extractComments(null)).toHaveLength(0)
  })
})

describe('REGRESSÃO: extractMessages', () => {
  it('extrai DM textual de entry.messaging', () => {
    const payload = {
      entry: [{
        id: 'IGID',
        messaging: [{
          sender: { id: 'IGSID' },
          recipient: { id: 'IGID' },
          message: { mid: 'm1', text: 'PROMPT' },
        }],
      }],
    }

    const result = extractMessages(payload, 'IGID')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      message_id: 'm1',
      from_id: 'IGSID',
      to_id: 'IGID',
      text: 'PROMPT',
    })
  })

  it('ignora mensagens echo da própria conta para não reprocessar giveaway já enviado', () => {
    const payload = {
      entry: [{
        id: 'IGID',
        messaging: [{
          sender: { id: 'IGID' },
          recipient: { id: 'IGSID' },
          message: { mid: 'm-echo', text: 'Aqui está seu prompt', is_echo: true },
        }],
      }],
    }

    expect(extractMessages(payload, 'IGID')).toHaveLength(0)
  })

  it('suporta changes[field=messages] e também ignora echo', () => {
    const payload = {
      entry: [{
        id: 'IGID',
        changes: [
          {
            field: 'messages',
            value: {
              from: { id: 'IGSID' },
              to: { id: 'IGID' },
              message: { mid: 'm2', text: 'PROMPT' },
            },
          },
          {
            field: 'messages',
            value: {
              from: { id: 'IGID' },
              to: { id: 'IGSID' },
              message: { mid: 'm3', text: 'echo', is_echo: true },
            },
          },
        ],
      }],
    }

    const result = extractMessages(payload, 'IGID')
    expect(result).toHaveLength(1)
    expect(result[0].message_id).toBe('m2')
  })
})

describe('REGRESSÃO: isKeywordCta (autoreply — comentário curto vira CTA follow+DM)', () => {
  it('1 palavra é keyword CTA', () => {
    expect(isKeywordCta('MINI')).toBe(true)
    expect(isKeywordCta('  link  ')).toBe(true)
  })

  it('2 palavras é keyword CTA', () => {
    expect(isKeywordCta('quero link')).toBe(true)
  })

  it('3+ palavras NÃO é keyword CTA (é conversa real)', () => {
    expect(isKeywordCta('manda o link pra mim')).toBe(false)
    expect(isKeywordCta('isso é muito bom')).toBe(false)
  })

  it('texto vazio não é CTA (e nem chega ao worker)', () => {
    expect(isKeywordCta('')).toBe(false)
    expect(isKeywordCta('   ')).toBe(false)
  })
})

describe('REGRESSÃO: classifyExternalError (cooldown sentinel — cláusula pétrea #10)', () => {
  it('HTTP 429 é rate_limited (cooldown longo)', () => {
    expect(classifyExternalError({ status: 429 })).toBe('rate_limited')
  })

  it('códigos de rate-limit da Meta (4/17/32/613) são rate_limited mesmo em HTTP 400', () => {
    for (const code of [4, 17, 32, 613]) {
      expect(classifyExternalError({ status: 400, graphCode: code })).toBe('rate_limited')
    }
  })

  it('HTTP 5xx é unavailable (cooldown curto)', () => {
    expect(classifyExternalError({ status: 500 })).toBe('unavailable')
    expect(classifyExternalError({ status: 503 })).toBe('unavailable')
  })

  it('timeout/abort/rede é unavailable', () => {
    expect(classifyExternalError({ message: 'The operation timed out' })).toBe('unavailable')
    expect(classifyExternalError({ message: 'AbortError: signal aborted' })).toBe('unavailable')
    expect(classifyExternalError({ message: 'fetch failed' })).toBe('unavailable')
  })

  it('token expirado (#190) e 4xx são permanent (contam tentativa → failed)', () => {
    expect(classifyExternalError({ status: 400, graphCode: 190 })).toBe('permanent')
    expect(classifyExternalError({ status: 403 })).toBe('permanent')
    expect(classifyExternalError({ message: 'missing_access_token' })).toBe('permanent')
    expect(classifyExternalError({ message: 'empty_reply' })).toBe('permanent')
  })

  it('classifica por mensagem quando não há status (erro do LLM)', () => {
    expect(classifyExternalError({ message: 'rate limit exceeded' })).toBe('rate_limited')
    expect(classifyExternalError({ message: 'Graph API 502' })).toBe('unavailable')
  })
})

describe('REGRESSÃO: isQuietHoursBRT (anti-ban — 23h-6h BRT, UTC-3)', () => {
  const utc = (h: number, m = 0) => Date.UTC(2026, 5, 16, h, m)
  it('madrugada BRT é quiet (true)', () => {
    expect(isQuietHoursBRT(utc(4))).toBe(true)   // 01:00 BRT
    expect(isQuietHoursBRT(utc(2))).toBe(true)   // 23:00 BRT
    expect(isQuietHoursBRT(utc(8))).toBe(true)   // 05:00 BRT
  })
  it('horário comercial BRT não é quiet (false)', () => {
    expect(isQuietHoursBRT(utc(15))).toBe(false) // 12:00 BRT
    expect(isQuietHoursBRT(utc(21))).toBe(false) // 18:00 BRT
  })
  it('bordas: 06:00 BRT (fim, exclusivo) e 22:59 BRT não são quiet', () => {
    expect(isQuietHoursBRT(utc(9))).toBe(false)      // 06:00 BRT
    expect(isQuietHoursBRT(utc(1, 59))).toBe(false)  // 22:59 BRT
  })
})

describe('REGRESSÃO: verifyChallenge', () => {
  it('handshake válido retorna challenge', () => {
    const p = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': 'abc123' })
    expect(verifyChallenge(p, 'tok')).toBe('abc123')
  })

  it('token errado retorna null', () => {
    const p = new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' })
    expect(verifyChallenge(p, 'tok')).toBeNull()
  })

  it('mode diferente de subscribe retorna null', () => {
    const p = new URLSearchParams({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': 'x' })
    expect(verifyChallenge(p, 'tok')).toBeNull()
  })
})
