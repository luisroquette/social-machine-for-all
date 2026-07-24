/**
 * REGRESSÃO: variante B de thread do X era truncada com slice() bruto, corrompendo
 * o JSON.stringify(array) armazenado em `content`.
 *
 * Causa: o bloco de variante B (linhas ~549-554) tratava `variantContent` como texto
 * plano em qualquer formato. Para `format: 'thread'`, `variantParsed.content` é um
 * array — `JSON.stringify(tweets)` frequentemente excede `platformConfig.maxLength`
 * (280 para X, que é o limite de UM tweet, não da thread inteira). O código então
 * cortava a string no meio do JSON (`variantContent.slice(0, maxLength - 3) + '...'`),
 * produzindo um valor que não é mais um JSON array válido.
 *
 * Esse `content` corrompido era salvo com status 'draft' e, ao chegar no publisher
 * (src/lib/agents/publisher/index.ts), o parse falhava e o item era marcado
 * permanentemente como 'failed' com review_feedback 'MalformedThread: JSON array
 * inválido — permanentemente rejeitado'. Confirmado em produção: 1657/1659 falhas
 * de MalformedThread no pipeline X tinham metadata.variant='B' e target_format='thread'
 * (query real em generated_content, 21/07/2026) — responsável por ~80% de todas as
 * falhas diárias do pipeline X.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGenerateSimpleText = vi.fn()
vi.mock('@/lib/ai/tool-loop', () => ({
  generateSimpleText: (...args: unknown[]) => mockGenerateSimpleText(...args),
  executeToolLoop: vi.fn().mockResolvedValue({ text: 'ok', tokensUsed: 10 }),
}))

vi.mock('@/lib/ai/parse-json', () => ({
  parseAIJson: vi.fn().mockImplementation((text: string) => JSON.parse(text)),
  AIJsonParseError: class AIJsonParseError extends Error {},
}))

vi.mock('@/lib/eval/engagement-insights', () => ({
  buildEngagementInsights: vi.fn().mockResolvedValue(''),
}))

vi.mock('@/lib/settings/platform-config', () => ({
  loadPlatformConfigs: vi.fn().mockResolvedValue([
    {
      platform: 'x',
      maxLength: 280,
      allowHashtags: false,
      maxHashtags: 0,
      allowEmojis: false,
      requireImage: false,
      tone: 'direto',
      styleGuide: '',
      engagementStyle: '',
      hashtagStrategy: '',
      active: true,
    },
  ]),
}))

vi.mock('@/lib/pipeline/dedup', () => ({
  hasDraftForCuratedItem: vi.fn().mockResolvedValue(false),
}))

const mockInsert = vi.fn().mockResolvedValue({ error: null })

const makeChain = (rows: unknown[]) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  not: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: rows, error: null, count: rows.length }),
  gt: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  insert: mockInsert,
})

const mockFromFn = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFromFn }),
}))

import { agent } from './index'

const WORKSPACE_ID = 'workspace-example-ai'

const makeCtx = (overrides = {}) => ({
  workspaceId: WORKSPACE_ID,
  agentId: 'agent-writer-test',
  brandContext: '',
  feedbackContext: '',
  memoryContext: '',
  dryRun: false,
  dbConfig: { model: 'deepseek-chat', max_actions_per_hour: 30, quiet_hours_start: 0, quiet_hours_end: 8, config: {} },
  ...overrides,
})

function setCuratedItem(item: Record<string, unknown>) {
  mockFromFn.mockImplementation((table: string) => {
    if (table === 'curated_content') return makeChain([item])
    if (table === 'generated_content') return makeChain([])
    return makeChain([])
  })
}

const BASE_ITEM = {
  id: 'curated-1',
  workspace_id: WORKSPACE_ID,
  topic_id: null,
  source_url: 'https://x.com/foo/status/1',
  source_author: 'foo',
  relevance_score: 50,
  score_breakdown: {},
  status: 'curated',
  source_metrics: {},
  source_platform: 'x',
  source_content: 'A'.repeat(400), // longo o bastante para sourceIsThread=true
}

// Cada tweet fica bem abaixo de 280 chars individualmente, mas o array
// stringificado inteiro (com aspas/colchetes/vírgulas do JSON) ultrapassa 280.
const THREAD_A = [
  'Tweet 1 da thread principal com um dado concreto qualquer para preencher espaço.',
  'Tweet 2 da thread principal com outro ponto relevante e uma comparação vs concorrente.',
  'Tweet 3 da thread principal fechando com uma conclusão clara sobre o tema 42.',
]
const THREAD_B = [
  'Tweet 1 da variante B com um HOOK completamente diferente e um dado concreto 99 para variar o gancho inicial.',
  'Tweet 2 da variante B expandindo o argumento com outro exemplo prático e uma comparação vs o contexto anterior.',
  'Tweet 3 da variante B trazendo mais um ponto de dados com o número 123 e uma citação relevante do setor.',
  'Tweet 4 da variante B encerrando com uma conclusão clara e uma chamada final sobre o número 7 para fechar a thread.',
]

describe('REGRESSÃO: variante B de thread do X não pode ser truncada com slice()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateSimpleText
      .mockResolvedValueOnce({ text: JSON.stringify({ content: THREAD_A, format: 'thread' }), tokensUsed: 100 })
      .mockResolvedValueOnce({ text: JSON.stringify({ content: THREAD_B, format: 'thread' }), tokensUsed: 100 })
    setCuratedItem(BASE_ITEM)
  })

  it('grava a variante B da thread como JSON válido, sem truncar no meio do array', async () => {
    await agent.execute(makeCtx())

    expect(mockInsert).toHaveBeenCalledTimes(2)
    const variantBCall = mockInsert.mock.calls[1][0]

    expect(variantBCall.metadata.variant).toBe('B')
    expect(variantBCall.target_format).toBe('thread')

    // Antes do fix: variantContent.length > 280 → slice(0, 277) + '...' quebrava o JSON.
    expect(() => JSON.parse(variantBCall.content)).not.toThrow()
    const parsedTweets = JSON.parse(variantBCall.content)
    expect(parsedTweets).toEqual(THREAD_B)
  })
})
