/**
 * REGRESSÃO: Writer — consumo de briefs SEO do SEO Strategist
 *
 * Cobre:
 * 1. Briefs pendentes (status='brief_pending') são processados e atualizados para 'draft'
 * 2. Writer não crasheia quando brief.content não é JSON válido
 * 3. Briefs não são processados quando não há itens (no-op)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockGenerateSimpleText = vi.fn()
vi.mock('@/lib/ai/tool-loop', () => ({
  generateSimpleText: (...args: unknown[]) => mockGenerateSimpleText(...args),
  executeToolLoop: vi.fn().mockResolvedValue({ text: 'ok', tokensUsed: 10 }),
}))

vi.mock('@/lib/ai/parse-json', () => ({
  parseAIJson: vi.fn().mockImplementation((text: string) => JSON.parse(text)),
  AIJsonParseError: class AIJsonParseError extends Error {},
}))

const mockUpdate = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) })
const mockInsert = vi.fn().mockResolvedValue({ error: null })

const makeChain = (rows: unknown[]) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
  gt: vi.fn().mockReturnThis(),
  or: vi.fn().mockReturnThis(),
  single: vi.fn().mockResolvedValue({ data: null, error: null }),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  insert: mockInsert,
})

vi.mock('@/lib/settings/platform-config', () => ({
  loadPlatformConfigs: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/pipeline/dedup', () => ({
  hasDraftForCuratedItem: vi.fn().mockResolvedValue(false),
}))

const mockFromFn = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFromFn }),
}))

import { agent } from './index'

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeCtx = (overrides = {}) => ({
  workspaceId: 'ws-writer-001',
  agentId: 'agent-writer-test',
  brandContext: '',
  feedbackContext: '',
  memoryContext: '',
  dryRun: false,
  dbConfig: { model: 'deepseek-chat', max_actions_per_hour: 30, quiet_hours_start: 0, quiet_hours_end: 8, config: {} },
  ...overrides,
})

const FAKE_BRIEF = {
  id: 'brief-001',
  content: JSON.stringify({
    intent: 'informacional',
    serp_feature: 'featured_snippet',
    kgr: { estimate: 0.3, confidence: 'media' },
    secondary_keywords: ['llm', 'modelos de linguagem'],
    headings: { h1: 'O que é IA Generativa?', h2s: ['Como funciona', 'Exemplos práticos'] },
    word_count: 1500,
    title_tag: 'IA Generativa: O Guia Completo (2025)',
    meta_description: 'Entenda o que é IA generativa e como ela funciona.',
    schema_type: 'Article',
    geo_angle: 'Resposta direta no primeiro parágrafo para AI Overviews.',
    eeat_tips: ['Citar papers', 'Mostrar exemplos reais'],
  }),
  metadata: {
    seo_brief: true,
    target_keyword: 'ia generativa',
    opportunity_score: 88,
    content_type: 'article',
  },
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: Writer — consumo de briefs SEO', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateSimpleText.mockResolvedValue({ text: '# IA Generativa\nArtigo gerado.', tokensUsed: 2000 })
  })

  it('REGRESSÃO: brief_pending é processado e atualizado para draft', async () => {
    const briefChain = makeChain([FAKE_BRIEF])
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const updateFn = vi.fn().mockReturnValue({ eq: updateEq })
    briefChain.update = updateFn

    // Supabase calls in order: platform_configs (via loadPlatformConfigs — mocked),
    // curated_content, rejected drafts, SEO briefs
    // We set mockFromFn to return appropriate chains per table
    mockFromFn.mockImplementation((table: string) => {
      if (table === 'generated_content') return briefChain
      if (table === 'curated_content') return makeChain([]) // sem itens curados
      return makeChain([])
    })

    const result = await agent.execute(makeCtx())

    // Writer deve ter chamado generateSimpleText para gerar o artigo
    expect(mockGenerateSimpleText).toHaveBeenCalled()

    // Update deve ter sido chamado com status='draft' e o conteúdo gerado
    expect(updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'draft',
        content: expect.stringContaining('IA Generativa'),
        target_format: 'article', // schema_type 'Article' → lowercased
      })
    )

    // Draft criado deve aparecer no resultado
    expect(result.itemsProduced).toBeGreaterThanOrEqual(1)
    const blogDrafts = (result.details as Record<string, unknown>)?.drafts as Array<Record<string, unknown>> | undefined
    expect(blogDrafts?.some(d => d.platform === 'blog')).toBe(true)
  })

  it('REGRESSÃO: brief com content inválido (não-JSON) não crasheia o writer', async () => {
    const invalidBrief = { ...FAKE_BRIEF, content: 'INVALID JSON {{{' }
    const briefChain = makeChain([invalidBrief])

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'generated_content') return briefChain
      if (table === 'curated_content') return makeChain([])
      return makeChain([])
    })

    // JSON.parse vai lançar — o writer deve capturar e continuar
    const result = await agent.execute(makeCtx())

    // Deve terminar sem throw
    expect(result).toBeDefined()
    // O erro do brief deve estar registrado nos errors
    expect(result.errors.some(e => e.includes('brief-001'))).toBe(true)
    // O erro deve mencionar a falha de escrita do brief (JSON parse error)
    expect(result.errors.some(e => e.includes('SEO brief writing failed'))).toBe(true)
  })

  it('REGRESSÃO: sem briefs pendentes — writer termina sem exceção', async () => {
    const emptyChain = makeChain([])

    mockFromFn.mockImplementation((table: string) => {
      if (table === 'generated_content') return emptyChain
      if (table === 'curated_content') return makeChain([])
      return makeChain([])
    })

    const result = await agent.execute(makeCtx())

    // Deve terminar sem throw
    expect(result).toBeDefined()
    // Sem briefs e sem platform configs → success: false com reason no_platform_configs
    // O importante é não ter erros de SEO briefs — só o erro esperado de configuração
    expect(result.errors.some(e => e.includes('SEO brief writing failed'))).toBe(false)
    expect(result.errors.some(e => e.includes('No active platform configs'))).toBe(true)
  })
})
