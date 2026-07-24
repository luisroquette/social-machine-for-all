/**
 * REGRESSÃO: geração de Variante B (A/B testing) desperdiçava uma chamada de LLM
 * inteira (maxTokens: 1500) para todo draft feed_post/carousel do Brand, sem
 * nunca gravar nada.
 *
 * Causa: o bloco de variante B só pula para isReelFormat — feed_post/carousel
 * (JSON estruturado headline/context/kpi/caption, sem campo "content") passavam
 * por ele. `variantParsed.content` é `undefined` nesse schema, e
 * `JSON.stringify(undefined)` retorna o valor `undefined` (não a string
 * "undefined"). A checagem seguinte, `variantContent.trim()`, lança TypeError —
 * engolido silenciosamente pelo catch "best-effort" do bloco, sem log e sem
 * nunca inserir a variante.
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
      platform: 'instagram',
      maxLength: 2200,
      allowHashtags: true,
      maxHashtags: 20,
      allowEmojis: true,
      requireImage: false,
      tone: 'profissional',
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

const BRAND_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

const makeCtx = (overrides = {}) => ({
  workspaceId: BRAND_WORKSPACE_ID,
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
  workspace_id: BRAND_WORKSPACE_ID,
  topic_id: null,
  source_url: 'https://x.com/foo/status/1',
  source_author: 'foo',
  relevance_score: 50,
  score_breakdown: { category: 'ev_news' },
  status: 'curated',
  source_metrics: {},
  source_platform: 'pillar',
  source_content: 'FATO 1: dado real',
}

describe('REGRESSÃO: variant B desperdiçava chamada de LLM para feed_post estruturado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateSimpleText.mockResolvedValue({
      text: JSON.stringify({ format: 'feed_post', headline: 'H', context: 'C', image_prompt: 'P', caption: 'Cap #x' }),
      tokensUsed: 100,
    })
    setCuratedItem(BASE_ITEM)
  })

  it('não gera (e descarta) uma segunda chamada de LLM para variante B de feed_post', async () => {
    await agent.execute(makeCtx())

    // Antes do fix: generateSimpleText era chamado 2x (draft principal + variante
    // B), mas a variante B sempre crashava silenciosamente e nunca era inserida —
    // puro desperdício de tokens/custo em toda geração de feed_post do Brand.
    expect(mockGenerateSimpleText).toHaveBeenCalledTimes(1)
    expect(mockInsert).toHaveBeenCalledTimes(1)
  })

  it('mecanismo do bug: JSON.stringify(undefined) não vira string e quebra .trim()', () => {
    const variantParsed = { format: 'feed_post' } as { content?: unknown }
    const variantContent = typeof variantParsed.content === 'string'
      ? variantParsed.content
      : JSON.stringify(variantParsed.content)
    expect(variantContent).toBeUndefined()
    expect(() => (variantContent as unknown as string).trim()).toThrow()
  })
})
