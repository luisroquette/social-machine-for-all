/**
 * TESTE DE REGRESSÃO — dedup idempotente de replies (anti-resposta-duplicada)
 *
 * Por que este teste existe:
 * Em Jun/2026 o @your_ai_profile respondeu o MESMO comentário de terceiro dezenas a
 * centenas de vezes (406x no pior caso histórico). Causa: a chave de deduplicação
 * usava um formato de URL (`https://x.com/i/web/status/{id}`) diferente do formato
 * gravado no insert (`reply.url` = `https://x.com/{user}/status/{id}`). A query de
 * dedup NUNCA encontrava a linha gravada → a cada run do cron o comentário era
 * re-enfileirado e re-respondido.
 *
 * Fix aplicado: o dedup passou a casar pelo ID do tweet (sufixo `/status/{id}`),
 * robusto às variações de formato de URL.
 *
 * Este teste simula um banco real (count = nº de linhas que casam com o predicado
 * da query) e roda execute() múltiplas vezes. Se o dedup voltar a usar uma chave
 * que não bate com o insert, a segunda run insere de novo e este teste quebra.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/platforms/x/twitterapi-io', () => ({
  searchTweetsIO: vi.fn(),
}))

vi.mock('@/lib/settings/load-settings', () => ({
  loadSettings: vi.fn(),
  getVariable: vi.fn().mockResolvedValue(''),
}))

vi.mock('@/lib/ai/tool-loop', () => ({
  generateSimpleText: vi.fn(),
}))

vi.mock('@/lib/ai/parse-json', () => ({
  parseAIJson: vi.fn(),
}))

// ── Banco simulado ──────────────────────────────────────────────────────────
// Guarda os target_url efetivamente inseridos. A query de dedup é traduzida num
// predicado e o "count" é o nº de linhas que casam — exatamente como o Postgres faria.
const insertedTargetUrls: string[] = []
let dedupPredicate: ((url: string) => boolean) | null = null

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => {
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (col === 'target_url') dedupPredicate = (u) => u === val
          return chain
        },
        ilike: (col: string, val: string) => {
          if (col === 'target_url') {
            const suffix = val.replace(/^%/, '')
            dedupPredicate = (u) => u.endsWith(suffix)
          }
          return chain
        },
        insert: (payload: any) => {
          const rows = Array.isArray(payload) ? payload : [payload]
          for (const r of rows) if (r?.target_url) insertedTargetUrls.push(r.target_url)
          return Promise.resolve({ error: null })
        },
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        // torna o chain "awaitable": resolve com o count calculado pelo predicado
        then: (resolve: any) => {
          const count = dedupPredicate
            ? insertedTargetUrls.filter(dedupPredicate).length
            : 0
          dedupPredicate = null
          resolve({ count, error: null })
        },
      }
      return chain
    },
  }),
}))

import { searchTweetsIO } from '@/lib/platforms/x/twitterapi-io'
import { loadSettings } from '@/lib/settings/load-settings'
import { generateSimpleText } from '@/lib/ai/tool-loop'
import { parseAIJson } from '@/lib/ai/parse-json'
import { agent } from './index'

const OWN_HANDLE = 'your_ai_profile'
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

function makeCtx(): Parameters<typeof agent.execute>[0] {
  return {
    workspaceId: WORKSPACE_ID,
    settings: {},
    brandContext: 'test brand',
    feedbackContext: '',
    pipelineRunId: 'test-run',
    dbConfig: { model: 'deepseek-chat', temperature: 0.8 },
  } as any
}

// Comentário real de terceiro (o caso @pliss_studio que disparou a investigação)
const THIRD_PARTY_REPLY = {
  id: '2066592467927908728',
  text: 'copiar seção é fácil. difícil é saber por que aquela seção funciona naquele negócio.',
  author: 'pliss_studio',
  url: 'https://x.com/pliss_studio/status/2066592467927908728',
  metrics: { likes: 1, retweets: 0, replies: 8, views: 12 },
  createdAt: new Date().toISOString(),
  mediaUrls: [],
}

describe('engagement-own — REGRESSÃO: dedup idempotente de replies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedTargetUrls.length = 0
    dedupPredicate = null
    ;(loadSettings as any).mockResolvedValue({ own_twitter_handle: OWN_HANDLE })
    ;(generateSimpleText as any).mockResolvedValue({
      text: '{"reply": "O por que vem do desenho do prompt pro contexto do dado.", "style": "complemento"}',
      tokensUsed: 100,
    })
    ;(parseAIJson as any).mockReturnValue({
      reply: 'O por que vem do desenho do prompt pro contexto do dado.',
      style: 'complemento',
    })
    // 1ª chamada (replies) → comentário de terceiro; 2ª chamada (topTweets p/ RT) → vazio
    ;(searchTweetsIO as any).mockImplementation((q: string) =>
      Promise.resolve(q.startsWith('to:') ? [THIRD_PARTY_REPLY] : [])
    )
  })

  it('responde uma única vez mesmo após múltiplas runs do cron', async () => {
    await agent.execute(makeCtx())
    const afterRun1 = insertedTargetUrls.length
    expect(afterRun1).toBeGreaterThan(0) // 1ª run: enfileira (comment + like)

    await agent.execute(makeCtx())
    await agent.execute(makeCtx())

    // Runs 2 e 3: o comentário já tem ação no banco → ZERO novas inserções.
    // Com o bug (dedup por URL formato errado), cada run re-inseria.
    expect(insertedTargetUrls.length).toBe(afterRun1)
  })

  it('dedup casa mesmo quando a linha gravada tem formato de URL diferente', async () => {
    // Simula uma linha histórica gravada num formato antigo (i/status) enquanto a
    // API agora devolve reply.url no formato x.com/{user}/status. O dedup por ID
    // do tweet precisa casar os dois.
    insertedTargetUrls.push(`https://x.com/i/status/${THIRD_PARTY_REPLY.id}`)

    await agent.execute(makeCtx())

    // Nenhuma inserção nova: o ID já existe no banco, ainda que noutro formato.
    expect(insertedTargetUrls.length).toBe(1)
  })

  it('positivo: comentário inédito ainda é respondido normalmente', async () => {
    await agent.execute(makeCtx())
    // comment + like para o comentário novo
    expect(insertedTargetUrls.filter((u) => u.includes(THIRD_PARTY_REPLY.id)).length)
      .toBeGreaterThan(0)
  })
})
