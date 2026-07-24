/**
 * TESTES DO SEO STRATEGIST — validação das ferramentas novas e comportamentos críticos
 *
 * Cobre:
 * 1. handleChat routing — regex isReportRequest
 * 2. execute — workspace ausente, topic_keywords vazio, sucesso
 * 3. audit_site — extração HTML (sem fetch real)
 * 4. analyze_schema — detecção de tipos depreciados, zero blocos
 * 5. analyze_geo — llms.txt check, scores GEO
 * 6. generate_content_brief — estrutura do brief
 * 7. optimize_content — rejeição de tweet/X
 * 8. get_keyword_report — grouping e topOpportunities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks declarados antes de qualquer import do módulo testado ──────────────

const mockGenerateSimpleText = vi.fn()
const mockExecuteToolLoop = vi.fn()
const mockParseAIJson = vi.fn()
const mockSendLongMessage = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/ai/tool-loop', () => ({
  generateSimpleText: (...args: unknown[]) => mockGenerateSimpleText(...args),
  executeToolLoop: (...args: unknown[]) => mockExecuteToolLoop(...args),
}))

vi.mock('@/lib/telegram/message-sender', () => ({
  sendLongMessage: (...args: unknown[]) => mockSendLongMessage(...args),
}))

vi.mock('@/lib/ai/parse-json', () => ({
  parseAIJson: (...args: unknown[]) => mockParseAIJson(...args),
  AIJsonParseError: class AIJsonParseError extends Error {},
}))

vi.mock('@/lib/analytics/google-auth', () => ({
  isGoogleConfigured: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/analytics/google-analytics', () => ({
  runGA4Report: vi.fn(),
  querySearchConsole: vi.fn(),
}))

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockUpsert = vi.fn().mockResolvedValue({ error: null })
const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockSingle = vi.fn()
const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null })

const mockKeywordsChain = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  contains: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  upsert: mockUpsert,
  insert: mockInsert,
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: vi.fn().mockReturnValue(mockKeywordsChain),
  }),
}))

// ── Global fetch mock ─────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Import do agente ──────────────────────────────────────────────────────────

import { agent } from './index'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Restaura as implementações de chain após vi.clearAllMocks() */
function resetChain() {
  mockKeywordsChain.select.mockReturnThis()
  mockKeywordsChain.eq.mockReturnThis()
  mockKeywordsChain.in.mockReturnThis()
  mockKeywordsChain.order.mockReturnThis()
  mockKeywordsChain.contains.mockReturnThis()
  mockKeywordsChain.limit.mockResolvedValue({ data: [], error: null })
  mockKeywordsChain.upsert.mockResolvedValue({ error: null })
  mockKeywordsChain.insert.mockResolvedValue({ error: null })
  mockMaybeSingle.mockResolvedValue({ data: null })
}

const makeCtx = (overrides = {}) => ({
  workspaceId: 'ws-test-001',
  agentId: 'agent-seo-test',
  brandContext: '',
  feedbackContext: '',
  memoryContext: '',
  dryRun: false,
  dbConfig: { model: 'claude-sonnet', max_actions_per_hour: 10, quiet_hours_start: 0, quiet_hours_end: 7, config: {} },
  ...overrides,
})

/** brand_config sem site_url por padrão — evita que generateStructuredReport dispare audit_site/fetch */
const makeWorkspaceResult = (topicKeywords: string[] = ['inteligencia artificial']) => ({
  data: { topic_keywords: topicKeywords, brand_config: {} },
  error: null,
})

// ── 1. handleChat routing ─────────────────────────────────────────────────────

describe('handleChat — routing isReportRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'resposta do agente', tokensUsed: 100 })
    mockGenerateSimpleText.mockResolvedValue({ text: '# Relatorio SEO\nConteudo', tokensUsed: 500 })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))
  })

  it('frases de relatorio ativam generateStructuredReport', async () => {
    // "auditoria" foi removido do regex pois "audita o site" deve ir para tool loop
    const triggers = ['relatorio', 'como está o seo', 'performance seo', 'overview do site', 'seo geral']
    for (const msg of triggers) {
      const result = await agent.handleChat(msg, makeCtx(), [])
      // generateStructuredReport chama generateSimpleText, não executeToolLoop
      expect(mockGenerateSimpleText).toHaveBeenCalled()
      expect(result.response).toBeTruthy()
      vi.clearAllMocks()
      resetChain()
      mockSingle.mockResolvedValue(makeWorkspaceResult())
      mockGenerateSimpleText.mockResolvedValue({ text: '# Relatorio', tokensUsed: 100 })
      mockParseAIJson.mockImplementation((text: string) => { try { return JSON.parse(text) } catch { return {} } })
    }
  })

  it('"auditoria" sozinha vai para tool loop (nao para relatório)', async () => {
    const result = await agent.handleChat('audita o site example.com', makeCtx(), [])
    expect(mockExecuteToolLoop).toHaveBeenCalled()
    expect(mockGenerateSimpleText).not.toHaveBeenCalled()
  })

  it('pedidos normais (audit, brief, keywords) vão para tool loop', async () => {
    const nonReportMessages = ['audita o site example.com', 'pesquisa keywords para IA', 'cria brief para chatgpt']
    for (const msg of nonReportMessages) {
      const result = await agent.handleChat(msg, makeCtx(), [])
      expect(mockExecuteToolLoop).toHaveBeenCalled()
      expect(result.response).toBe('resposta do agente')
      vi.clearAllMocks()
      resetChain()
      mockExecuteToolLoop.mockResolvedValue({ text: 'resposta do agente', tokensUsed: 100 })
    }
  })
})

// ── 2. execute — scheduled run ────────────────────────────────────────────────

describe('execute — scheduled keyword research', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Fix date to a Tuesday (non-Monday) so Monday-only branches (brief generation, weekly report)
    // don't fire and interfere with call count assertions.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T12:00:00Z')) // Tuesday UTC = Tuesday BRT
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retorna erro quando workspace não existe', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const result = await agent.execute(makeCtx())
    expect(result.success).toBe(false)
    expect(result.errors[0]).toMatch(/workspace/i)
  })

  it('retorna sucesso vazio quando topic_keywords está vazio', async () => {
    mockSingle.mockResolvedValue(makeWorkspaceResult([]))
    const result = await agent.execute(makeCtx())
    expect(result.success).toBe(true)
    expect(result.itemsProcessed).toBe(0)
    expect(result.details?.reason).toBe('no_topic_keywords')
  })

  it('pesquisa keywords por topico e persiste no banco', async () => {
    mockSingle.mockResolvedValue(makeWorkspaceResult(['ia generativa', 'llm']))
    mockKeywordsChain.limit.mockResolvedValue({ data: [], error: null })
    mockGenerateSimpleText.mockResolvedValue({ text: '[]', tokensUsed: 300 })
    mockParseAIJson.mockReturnValue([
      { keyword: 'ia generativa brasil', search_volume: 1200, difficulty: 40, opportunity_score: 80 },
      { keyword: 'como usar llm', search_volume: 500, difficulty: 20, opportunity_score: 90 },
    ])

    const result = await agent.execute(makeCtx())
    expect(result.success).toBe(true)
    expect(mockGenerateSimpleText).toHaveBeenCalledTimes(2) // 1 per topic
    expect(mockUpsert).toHaveBeenCalled()
    expect(result.itemsProduced).toBeGreaterThanOrEqual(0)
  })
})

// ── 3. audit_site — HTML extraction ──────────────────────────────────────────

describe('REGRESSÃO: audit_site — extração de elementos SEO do HTML', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  const makeHtmlFetch = (html: string) =>
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => html,
      headers: {
        get: (h: string) => {
          if (h === 'strict-transport-security') return 'max-age=31536000'
          if (h === 'x-frame-options') return 'DENY'
          return null
        },
      },
    })

  it('detecta H1 único, H2 count, canonical, HTTPS corretamente', async () => {
    const html = `
      <html><head>
        <title>Teste SEO</title>
        <meta name="description" content="Uma descricao de teste">
        <link rel="canonical" href="https://example.com/teste">
        <meta property="og:title" content="OG Teste">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="viewport" content="width=device-width">
      </head><body>
        <h1>Titulo principal</h1>
        <h2>Secao 1</h2><h2>Secao 2</h2>
        <img src="a.png" alt="desc"><img src="b.png">
        <a href="/sobre">link interno</a>
        <script type="application/ld+json">{"@type": "Article", "@context": "https://schema.org"}</script>
      </body></html>
    `

    makeHtmlFetch(html)
    mockGenerateSimpleText.mockResolvedValue({ text: '{"score":85,"issues":[],"recommendations":[],"schema_health":"ok","geo_ready":true}', tokensUsed: 200 })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))
    mockKeywordsChain.insert.mockResolvedValue({ error: null })

    // Triggera o tool via handleChat
    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const auditTool = tools.find((t: any) => t.name === 'audit_site')
      const result = await auditTool.execute({ domain: 'https://example.com' })

      // Valida que a extração está correta
      expect(result.onPage.h1Count).toBe(1)
      expect(result.onPage.h2Count).toBe(2)
      expect(result.onPage.canonical).toBe('https://example.com/teste')
      expect(result.technical.isHttps).toBe(true)
      expect(result.technical.hasHSTSHeader).toBe(true)
      expect(result.schema.types).toEqual(['Article'])
      expect(result.schema.health).toBe('ok')
      expect(result.geo_ready).toBe(true)
      expect(result.content.imgMissingAlt).toBe(1) // b.png sem alt

      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('audita https://example.com', makeCtx(), [])
  })

  it('retorna schema_health=missing quando não há JSON-LD', async () => {
    const html = `<html><head><title>Sem schema</title></head><body><h1>Oi</h1></body></html>`

    makeHtmlFetch(html)
    mockGenerateSimpleText.mockResolvedValue({ text: '{"score":40,"issues":["sem schema"],"recommendations":[],"schema_health":"missing","geo_ready":false}', tokensUsed: 100 })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))
    mockKeywordsChain.insert.mockResolvedValue({ error: null })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const auditTool = tools.find((t: any) => t.name === 'audit_site')
      const result = await auditTool.execute({ domain: 'https://example.com' })
      expect(result.schema.types).toEqual([])
      expect(result.schema.health).toBe('missing')
      expect(result.geo_ready).toBe(false)
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('audita https://example.com', makeCtx(), [])
  })
})

// ── 4. analyze_schema — tipos depreciados ────────────────────────────────────

describe('REGRESSÃO: analyze_schema — detecção de tipos depreciados', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('detecta SpecialAnnouncement e ClaimReview como depreciados', async () => {
    const html = `
      <script type="application/ld+json">{"@type": "Article", "@context": "https://schema.org"}</script>
      <script type="application/ld+json">{"@type": "SpecialAnnouncement", "@context": "https://schema.org"}</script>
      <script type="application/ld+json">{"@type": "ClaimReview", "@context": "https://schema.org"}</script>
    `
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html, headers: { get: () => null } })
    mockGenerateSimpleText.mockResolvedValue({
      text: '{"validation":[],"overall_score":45,"critical_issues":["SpecialAnnouncement depreciado"],"recommendations":[]}',
      tokensUsed: 200,
    })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'analyze_schema')
      const result = await tool.execute({ url: 'https://example.com/pagina' })

      expect(result.hasDeprecated).toBe(true)
      expect(result.deprecatedTypes).toContain('SpecialAnnouncement')
      expect(result.deprecatedTypes).toContain('ClaimReview')
      expect(result.schemaCount).toBe(3)
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('analisa schema de https://example.com/pagina', makeCtx(), [])
  })

  it('retorna message de orientação quando não há nenhum schema', async () => {
    const html = `<html><body><p>sem schema</p></body></html>`
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html, headers: { get: () => null } })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'analyze_schema')
      const result = await tool.execute({ url: 'https://example.com/vazia' })

      expect(result.schemaCount).toBe(0)
      expect(result.types).toEqual([])
      expect(result.issues).toBeDefined()
      expect(result.issues[0]).toMatch(/nenhum schema/i)
      // NÃO deve chamar generateSimpleText quando não há blocos
      expect(mockGenerateSimpleText).not.toHaveBeenCalled()
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('analisa schema', makeCtx(), [])
  })

  it('detecta placeholder text em schema', async () => {
    const html = `
      <script type="application/ld+json">{"@type": "Organization", "name": "[Business Name]", "@context": "https://schema.org"}</script>
    `
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => html, headers: { get: () => null } })
    mockGenerateSimpleText.mockResolvedValue({
      text: '{"validation":[],"overall_score":20,"critical_issues":["placeholder encontrado"],"recommendations":[]}',
      tokensUsed: 100,
    })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'analyze_schema')
      const result = await tool.execute({ url: 'https://example.com/placeholder' })
      expect(result.hasPlaceholders).toBe(true)
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('analisa schema placeholder', makeCtx(), [])
  })
})

// ── 5. analyze_geo — scores e llms.txt ───────────────────────────────────────

describe('REGRESSÃO: analyze_geo — scores GEO e llms.txt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('detecta llms.txt presente e retorna scores por dimensão', async () => {
    const html = `<html><body><h1>IA Generativa</h1><p>Em 2024, 67% das empresas adotaram IA...</p></body></html>`

    // fetch page + fetch /llms.txt (ok)
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => html, headers: { get: () => null } })
      .mockResolvedValueOnce({ ok: true }) // /llms.txt exists

    mockGenerateSimpleText.mockResolvedValue({
      text: JSON.stringify({
        geo_score: 72,
        scores: { direct_answer: 6, specific_data: 8, citable_structure: 7, entity_clarity: 5, topic_coverage: 8, eeat_signals: 4 },
        strengths: ['dados especificos'],
        gaps: ['entidade do autor nao clara'],
        recommendations: ['adicionar bio do autor'],
        llms_txt: true,
        best_for: ['google_ai_overviews'],
      }),
      tokensUsed: 300,
    })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'analyze_geo')
      const result = await tool.execute({ url: 'https://example.com/artigo' })

      expect(result.geo_score).toBe(72)
      expect(result.has_llms_txt).toBe(true)
      expect(result.scores.specific_data).toBe(8)
      expect(result.best_for).toContain('google_ai_overviews')
      expect(result.recommendations).toBeDefined()
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('analisa geo de https://example.com/artigo', makeCtx(), [])
  })

  it('reporta llms.txt ausente quando 404', async () => {
    const html = `<html><body><p>conteudo</p></body></html>`

    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => html, headers: { get: () => null } })
      .mockResolvedValueOnce({ ok: false }) // /llms.txt 404

    mockGenerateSimpleText.mockResolvedValue({
      text: JSON.stringify({
        geo_score: 40,
        scores: { direct_answer: 3, specific_data: 4, citable_structure: 5, entity_clarity: 3, topic_coverage: 5, eeat_signals: 3 },
        strengths: [],
        gaps: ['sem /llms.txt'],
        recommendations: ['criar /llms.txt'],
        llms_txt: false,
        best_for: [],
      }),
      tokensUsed: 200,
    })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'analyze_geo')
      const result = await tool.execute({ url: 'https://example.com' })
      expect(result.has_llms_txt).toBe(false)
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('geo check', makeCtx(), [])
  })
})

// ── 6. generate_content_brief — estrutura obrigatória ────────────────────────

describe('generate_content_brief — campos obrigatórios', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockKeywordsChain.limit.mockResolvedValue({ data: [], error: null })
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('retorna brief com todos os campos do contrato', async () => {
    const fakeBrief = {
      intent: 'informacional',
      serp_feature: 'featured_snippet',
      kgr: { estimate: 0.15, confidence: 'media' },
      secondary_keywords: ['ia generativa 2025', 'llm brasil'],
      headings: {
        h1: 'Como Usar IA Generativa no Brasil',
        h2s: ['O que é IA Generativa', 'Casos de Uso'],
        h3s: { 'O que é IA Generativa': ['Definição', 'Histórico'] },
      },
      word_count: 1800,
      title_tag: 'IA Generativa no Brasil: Guia Completo 2025',
      meta_description: 'Aprenda como usar IA generativa no Brasil com exemplos práticos e ferramentas.',
      schema_type: 'Article',
      geo_angle: 'Resposta direta: IA generativa é...',
      eeat_tips: ['Incluir casos reais de uso'],
      competing_keywords: [],
    }

    mockGenerateSimpleText.mockResolvedValue({ text: JSON.stringify(fakeBrief), tokensUsed: 400 })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'generate_content_brief')
      const result = await tool.execute({ keyword: 'ia generativa brasil', content_type: 'article' })

      expect(result.ok).toBe(true)
      expect(result.keyword).toBe('ia generativa brasil')
      expect(result.brief.intent).toBe('informacional')
      expect(result.brief.kgr.estimate).toBeLessThan(0.25) // KGR excelente
      expect(result.brief.headings.h1).toBeTruthy()
      expect(result.brief.headings.h2s.length).toBeGreaterThan(0)
      expect(result.brief.title_tag.length).toBeLessThanOrEqual(60)
      expect(result.brief.meta_description.length).toBeLessThanOrEqual(160)
      expect(result.brief.schema_type).toBeTruthy()
      expect(result.brief.geo_angle).toBeTruthy()
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('cria brief para ia generativa brasil', makeCtx(), [])
  })
})

// ── 7. optimize_content — rejeição de X/Twitter ───────────────────────────────

describe('REGRESSÃO: optimize_content — não otimiza tweets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('retorna erro ao tentar otimizar conteudo da plataforma x', async () => {
    mockKeywordsChain.single.mockResolvedValueOnce({
      data: { id: 'cnt-001', content: 'Tweet de teste', target_platform: 'x', status: 'draft' },
      error: null,
    })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'optimize_content')
      const result = await tool.execute({ content_id: 'cnt-001' })

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/tweet/i)
      // NÃO deve chamar generateSimpleText para tweets
      expect(mockGenerateSimpleText).not.toHaveBeenCalled()
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('otimiza cnt-001', makeCtx(), [])
  })

  it('retorna erro ao tentar otimizar plataforma twitter', async () => {
    // Reset mock para retornar na chain de single que pertence a generated_content
    mockKeywordsChain.single.mockResolvedValueOnce({
      data: { id: 'cnt-002', content: 'outro tweet', target_platform: 'twitter', status: 'draft' },
      error: null,
    })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'optimize_content')
      const result = await tool.execute({ content_id: 'cnt-002' })
      expect(result.ok).toBe(false)
      expect(mockGenerateSimpleText).not.toHaveBeenCalled()
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('otimiza cnt-002', makeCtx(), [])
  })

  it('otimiza conteudo blog normalmente', async () => {
    mockKeywordsChain.single.mockResolvedValueOnce({
      data: { id: 'cnt-003', content: 'Artigo sobre IA com mais de 100 palavras de conteudo rico.', target_platform: 'blog', status: 'draft' },
      error: null,
    })
    mockKeywordsChain.limit.mockResolvedValue({ data: [{ keyword: 'ia generativa', opportunity_score: 85 }], error: null })
    mockGenerateSimpleText.mockResolvedValue({
      text: '{"optimized_content":"Artigo melhorado...","changes_made":["added direct answer"],"keywords_used":["ia generativa"],"meta_description":"desc","title_tag":"Titulo","geo_improvements":["direct answer block added"],"eeat_score_before":5,"eeat_score_after":8}',
      tokensUsed: 800,
    })
    mockParseAIJson.mockImplementation((text: string) => JSON.parse(text))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'optimize_content')
      const result = await tool.execute({ content_id: 'cnt-003' })

      expect(result.ok).toBe(true)
      expect(result.eeat_score_after).toBeGreaterThan(result.eeat_score_before)
      expect(mockGenerateSimpleText).toHaveBeenCalledTimes(1)
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('otimiza cnt-003', makeCtx(), [])
  })
})

// ── 8. get_keyword_report — grouping ─────────────────────────────────────────

describe('get_keyword_report — agrupamento e top oportunidades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('retorna mensagem orientativa quando não há keywords', async () => {
    mockKeywordsChain.limit.mockResolvedValue({ data: [], error: null })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'get_keyword_report')
      const result = await tool.execute({})

      expect(result.ok).toBe(true)
      expect(result.message).toMatch(/nenhuma keyword/i)
      expect(result.topOpportunities).toEqual([])
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('keyword tracker dashboard', makeCtx(), [])
  })

  it('agrupa por status e retorna top 10 oportunidades', async () => {
    const keywords = [
      { keyword: 'ia brasil', search_volume: 1000, difficulty: 30, current_rank: 5, opportunity_score: 90, status: 'tracking' },
      { keyword: 'llm open source', search_volume: 800, difficulty: 20, current_rank: null, opportunity_score: 85, status: 'tracking' },
      { keyword: 'chatgpt gratis', search_volume: 5000, difficulty: 80, current_rank: 25, opportunity_score: 40, status: 'ranked' },
      { keyword: 'bing ai', search_volume: 300, difficulty: 90, current_rank: null, opportunity_score: 10, status: 'lost' },
    ]
    // get_keyword_report: .order() retorna this, .limit(1000) é o terminal
    mockKeywordsChain.limit.mockResolvedValue({ data: keywords, error: null })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'get_keyword_report')
      const result = await tool.execute({})

      expect(result.ok).toBe(true)
      expect(result.totalKeywords).toBe(4)
      expect(result.byStatus.tracking).toBe(2)
      expect(result.byStatus.ranked).toBe(1)
      expect(result.byStatus.lost).toBe(1)
      // keywords com status 'lost' não devem aparecer em topOpportunities
      const topKws = result.topOpportunities.map((k: any) => k.keyword)
      expect(topKws).not.toContain('bing ai')
      // top deve ser ordenado por opportunity_score (desc)
      expect(topKws[0]).toBe('ia brasil')
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('keyword tracker dashboard status', makeCtx(), [])
  })
})

// ── 9. REGRESSÃO: audit_site fetch failure ────────────────────────────────────

describe('REGRESSÃO: audit_site — falha de fetch retorna ok:false sem lançar exceção', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('retorna ok:false quando fetch lança exceção de rede (timeout/DNS)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed: ECONNREFUSED'))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'audit_site')
      const result = await tool.execute({ domain: 'https://example.com' })

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/fetch falhou/i)
      // NÃO deve lançar exceção — deve retornar objeto de erro
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('audita https://example.com', makeCtx(), [])
  })

  it('retorna ok:false quando fetch retorna status 5xx', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
      headers: { get: () => null },
    })

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'audit_site')
      const result = await tool.execute({ domain: 'https://example.com' })

      expect(result.ok).toBe(false)
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('audita https://example.com', makeCtx(), [])
  })
})

// ── 10. REGRESSÃO: analyze_schema com fetch failure ───────────────────────────

describe('REGRESSÃO: analyze_schema — fetch failure retorna ok:false sem exceção', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
    mockSingle.mockResolvedValue(makeWorkspaceResult())
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
  })

  it('retorna ok:false quando fetch de schema lança exceção de rede', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'))

    mockExecuteToolLoop.mockImplementationOnce(async ({ tools }: any) => {
      const tool = tools.find((t: any) => t.name === 'analyze_schema')
      const result = await tool.execute({ url: 'https://example.com/pagina' })

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
      return { text: 'ok', tokensUsed: 10 }
    })

    await agent.handleChat('analisa schema', makeCtx(), [])
  })
})

// ── 11. REGRESSÃO: execute() — parseAIJson retorna não-array ─────────────────

describe('REGRESSÃO: execute() — parseAIJson retorna não-array não crasheia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
  })

  it('trata resposta malformada da IA como array vazio (sem crash)', async () => {
    mockSingle.mockResolvedValue(makeWorkspaceResult(['ia generativa']))
    mockGenerateSimpleText.mockResolvedValue({ text: '{}', tokensUsed: 100 }) // objeto, não array
    // parseAIJson retorna objeto em vez de array — cenário de resposta malformada
    mockParseAIJson.mockReturnValue({ keyword: 'ia generativa', search_volume: 100 })

    const result = await agent.execute(makeCtx())

    // Não deve lançar TypeError: keywords.map is not a function
    expect(result.success).toBe(true)
    // Sem keywords válidas — nenhum upsert
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('trata parseAIJson retornando null sem crash', async () => {
    mockSingle.mockResolvedValue(makeWorkspaceResult(['llm']))
    mockGenerateSimpleText.mockResolvedValue({ text: 'null', tokensUsed: 50 })
    mockParseAIJson.mockReturnValue(null)

    const result = await agent.execute(makeCtx())

    expect(result.success).toBe(true)
    expect(mockUpsert).not.toHaveBeenCalled()
  })
})

// ── 12. REGRESSÃO: generateStructuredReport — sc-domain: não quebra audit_site ──

describe('REGRESSÃO: generateStructuredReport — sc-domain: convertido para https:// em audit_site', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
    mockExecuteToolLoop.mockResolvedValue({ text: 'ok', tokensUsed: 10 })
    mockGenerateSimpleText.mockResolvedValue({ text: '# Relatório\nOk', tokensUsed: 100 })
    mockParseAIJson.mockReturnValue({})
  })

  it('REGRESSÃO: seo_site_url = sc-domain:example.com — audit_site recebe https://example.com', async () => {
    // Workspace com site_url em formato GSC domain property
    mockSingle.mockResolvedValue({
      data: {
        topic_keywords: [],
        brand_config: { site_url: 'sc-domain:example.com' },
      },
      error: null,
    })
    // audit_site será chamado com https://example.com (derivado do sc-domain:)
    // Se a conversão não ocorrer, validateUrl lança "Protocolo nao permitido" e o relatório falha
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html><head><title>Test</title></head><body><h1>Test</h1></body></html>',
      headers: { get: () => null },
    })
    mockGenerateSimpleText.mockResolvedValue({
      text: '{"score":80,"issues":[],"recommendations":[],"schema_health":"missing","geo_ready":false}',
      tokensUsed: 200,
    })
    mockParseAIJson.mockImplementation((text: string) => { try { return JSON.parse(text) } catch { return {} } })

    const result = await agent.handleChat('relatorio seo', makeCtx(), [])

    // Se a conversão sc-domain → https:// falhou, o resultado conteria "Protocolo nao permitido"
    expect(result.response).not.toMatch(/Protocolo nao permitido/i)
    expect(result.response).not.toMatch(/Erro ao gerar relat/i)
  })

  it('seo_site_url = https://example.com — permanece inalterado (não duplica https://)', async () => {
    mockSingle.mockResolvedValue({
      data: {
        topic_keywords: [],
        brand_config: { site_url: 'https://example.com' },
      },
      error: null,
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '<html><head><title>Test</title></head><body><h1>Test</h1></body></html>',
      headers: { get: () => null },
    })
    mockGenerateSimpleText.mockResolvedValue({
      text: '{"score":80,"issues":[],"recommendations":[],"schema_health":"missing","geo_ready":false}',
      tokensUsed: 200,
    })
    mockParseAIJson.mockImplementation((text: string) => { try { return JSON.parse(text) } catch { return {} } })

    const result = await agent.handleChat('relatorio seo', makeCtx(), [])

    // Sem erros de protocolo e sem "https://https://"
    expect(result.response).not.toMatch(/Protocolo nao permitido/i)
    expect(result.response).not.toMatch(/https:\/\/https:\/\//i)
    expect(result.response).not.toMatch(/Erro ao gerar relat/i)
  })
})

// ── 13. REGRESSÃO: relatório semanal — segunda-feira envia via Telegram ───────

describe('REGRESSÃO: execute() — relatório semanal na segunda-feira', () => {
  const MONDAY_UTC = new Date('2026-05-11T12:00:00.000Z') // segunda-feira 09:00 BRT
  const TUESDAY_UTC = new Date('2026-05-12T12:00:00.000Z') // terça-feira

  const makeCtxWithTelegram = () => ({
    ...makeCtx(),
    telegramBotToken: 'bot123:TEST',
    telegramChatId: -1001234567890,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
    mockParseAIJson.mockReturnValue([])
    mockGenerateSimpleText.mockResolvedValue({ text: '# Relatório Semanal\nConteudo do relatorio', tokensUsed: 5000 })
    mockSendLongMessage.mockResolvedValue(undefined)
  })

  it('REGRESSÃO: na segunda-feira envia relatório via Telegram', async () => {
    vi.setSystemTime(MONDAY_UTC)
    mockSingle.mockResolvedValue(makeWorkspaceResult([]))

    const result = await agent.execute(makeCtxWithTelegram())

    expect(result.success).toBe(true)
    expect(result.details?.weeklyReportSent).toBe(true)
    expect(mockGenerateSimpleText).toHaveBeenCalled() // generateStructuredReport chamado
    expect(mockSendLongMessage).toHaveBeenCalledWith(
      'bot123:TEST',
      -1001234567890,
      expect.stringContaining('Relatório')
    )

    vi.useRealTimers()
  })

  it('REGRESSÃO: em outros dias NÃO envia relatório nem chama generateStructuredReport', async () => {
    vi.setSystemTime(TUESDAY_UTC)
    mockSingle.mockResolvedValue(makeWorkspaceResult([]))

    const result = await agent.execute(makeCtxWithTelegram())

    expect(result.success).toBe(true)
    expect(result.details?.weeklyReportSent).toBe(false)
    expect(mockSendLongMessage).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it('REGRESSÃO: sem telegramChatId NÃO envia mesmo na segunda-feira', async () => {
    vi.setSystemTime(MONDAY_UTC)
    mockSingle.mockResolvedValue(makeWorkspaceResult([]))

    // ctx sem telegram
    const result = await agent.execute(makeCtx())

    expect(result.success).toBe(true)
    expect(result.details?.weeklyReportSent).toBe(false)
    expect(mockSendLongMessage).not.toHaveBeenCalled()

    vi.useRealTimers()
  })
})

// ── 14. REGRESSÃO: geração de briefs na segunda-feira ────────────────────────

describe('REGRESSÃO: execute() — geração de briefs SEO na segunda-feira', () => {
  const MONDAY_UTC = new Date('2026-05-11T12:00:00.000Z') // segunda-feira 09:00 BRT
  const TUESDAY_UTC = new Date('2026-05-12T12:00:00.000Z') // terça-feira

  const FAKE_KW = { keyword: 'ia generativa', search_volume: 1000, difficulty: 30, opportunity_score: 88 }
  const FAKE_BRIEF = { intent: 'informacional', title_tag: 'IA Generativa: Guia', word_count: 1500, schema_type: 'Article' }

  beforeEach(() => {
    vi.clearAllMocks()
    resetChain()
    mockSendLongMessage.mockResolvedValue(undefined)
    mockMaybeSingle.mockResolvedValue({ data: null }) // sem brief existente
  })

  it('REGRESSÃO: na segunda-feira gera brief e insere no banco', async () => {
    vi.setSystemTime(MONDAY_UTC)
    mockSingle.mockResolvedValue(makeWorkspaceResult(['ia generativa']))

    // 1a chamada: keyword research → retorna array
    // 2a chamada: brief generation → retorna objeto de brief
    // 3a chamada: generateStructuredReport (relatório semanal) → retorna texto
    mockGenerateSimpleText
      .mockResolvedValueOnce({ text: '[]', tokensUsed: 200 }) // keyword research
      .mockResolvedValueOnce({ text: '{}', tokensUsed: 200 }) // brief
      .mockResolvedValueOnce({ text: '# Relatório\nConteudo', tokensUsed: 5000 }) // report

    mockParseAIJson
      .mockReturnValueOnce([FAKE_KW]) // keyword research → array de keywords
      .mockReturnValueOnce(FAKE_BRIEF) // brief generation → objeto brief

    const result = await agent.execute({ ...makeCtx(), telegramBotToken: 'bot:TEST', telegramChatId: -123 })

    expect(result.success).toBe(true)
    expect(result.details?.briefsGenerated).toBe(1)
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_platform: 'blog',
        target_format: 'seo_brief',
        status: 'brief_pending',
        metadata: expect.objectContaining({ seo_brief: true, target_keyword: 'ia generativa' }),
      })
    )

    vi.useRealTimers()
  })

  it('REGRESSÃO: em outros dias NÃO gera briefs', async () => {
    vi.setSystemTime(TUESDAY_UTC)
    mockSingle.mockResolvedValue(makeWorkspaceResult(['ia generativa']))

    mockGenerateSimpleText.mockResolvedValue({ text: '[]', tokensUsed: 200 })
    mockParseAIJson.mockReturnValue([FAKE_KW])

    const result = await agent.execute(makeCtx())

    expect(result.success).toBe(true)
    expect(result.details?.briefsGenerated).toBe(0)
    // insert para seo_brief NÃO deve ter sido chamado
    const briefInsertCalls = mockInsert.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?.target_format === 'seo_brief'
    )
    expect(briefInsertCalls.length).toBe(0)

    vi.useRealTimers()
  })

  it('REGRESSÃO: brief já existente para keyword é ignorado (sem duplicata)', async () => {
    vi.setSystemTime(MONDAY_UTC)
    mockSingle.mockResolvedValue(makeWorkspaceResult(['ia generativa']))

    // Simula brief já existente no banco
    mockMaybeSingle.mockResolvedValue({ data: { id: 'existing-brief-id' } })

    mockGenerateSimpleText
      .mockResolvedValueOnce({ text: '[]', tokensUsed: 200 }) // keyword research
      .mockResolvedValueOnce({ text: '# Relatório', tokensUsed: 5000 }) // report (Monday)

    mockParseAIJson.mockReturnValue([FAKE_KW])

    const result = await agent.execute({ ...makeCtx(), telegramBotToken: 'bot:TEST', telegramChatId: -123 })

    expect(result.success).toBe(true)
    expect(result.details?.briefsGenerated).toBe(0) // skipped — já existe
    // insert para seo_brief NÃO deve ter sido chamado
    const briefInsertCalls = mockInsert.mock.calls.filter(
      (call: unknown[]) => (call[0] as Record<string, unknown>)?.target_format === 'seo_brief'
    )
    expect(briefInsertCalls.length).toBe(0)

    vi.useRealTimers()
  })
})
