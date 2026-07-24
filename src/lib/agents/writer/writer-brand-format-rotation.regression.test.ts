/**
 * REGRESSÃO: feed_post/carousel do @brand só nascem de source_platform='pillar'
 *
 * Contexto: até este fix, qualquer item de notícia não-vídeo (X ou YouTube) virava
 * feed_post/carousel via rotação de slot — essa era a causa raiz de ~91% de rejeição
 * de carrossel (o writer não tinha dado suficiente numa única notícia curta pra
 * sustentar 5 slides). O fix (evergreen-seed-brand + brand_pillar_facts) resolve
 * isso alimentando a IA com fatos reais — mas só funciona se news items pararem de
 * competir pelo mesmo formato. Este teste garante que o bloqueio está em vigor.
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

vi.mock('@/lib/settings/load-settings', () => ({
  getVariable: vi.fn().mockResolvedValue(null),
  getNumericVariable: vi.fn().mockResolvedValue(null),
  loadSettings: vi.fn().mockResolvedValue({
    feature_instagram_image_generation: 'true',
    feature_evergreen_content: 'true',
    feature_video_reels: 'true',
    feature_ev_market_curation: 'true',
  }),
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

const FEATURED_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

const makeCtx = (overrides = {}) => ({
  workspaceId: FEATURED_WORKSPACE_ID,
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
  workspace_id: FEATURED_WORKSPACE_ID,
  topic_id: null,
  source_url: 'https://x.com/foo/status/1',
  source_author: 'foo',
  relevance_score: 50,
  score_breakdown: { category: 'ev_news' },
  status: 'curated',
  source_metrics: {},
}

describe('REGRESSÃO: brand format rotation — feed_post/carousel só de source_platform=pillar|seasonal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGenerateSimpleText.mockResolvedValue({
      text: JSON.stringify({ format: 'feed_post', headline: 'H', context: 'C', image_prompt: 'P', caption: 'Cap #x' }),
      tokensUsed: 100,
    })
  })

  it('item de notícia X (não video-eligible) NÃO gera draft de Instagram', async () => {
    setCuratedItem({ ...BASE_ITEM, source_platform: 'x', source_content: 'noticia qualquer sobre EV' })

    await agent.execute(makeCtx())

    expect(mockGenerateSimpleText).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('REGRESSÃO: item de notícia YouTube (não video-eligible) NÃO gera mais carousel automático', async () => {
    setCuratedItem({ ...BASE_ITEM, source_platform: 'youtube', source_content: 'video de youtube sobre EV' })

    await agent.execute(makeCtx())

    // Antes do fix, isto SEMPRE virava carousel. Agora deve ser pulado.
    expect(mockGenerateSimpleText).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('item evergreen (source_platform=pillar) gera draft de feed_post/carousel normalmente', async () => {
    setCuratedItem({ ...BASE_ITEM, source_platform: 'pillar', source_content: 'FATO 1: dado real\nFATO 2: outro dado' })

    await agent.execute(makeCtx())

    expect(mockGenerateSimpleText).toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: FEATURED_WORKSPACE_ID,
        target_platform: 'instagram',
        target_format: 'feed_post',
      }),
    )
  })

  it('item sazonal (source_platform=seasonal, calendário de datas comemorativas) gera draft de feed_post/carousel normalmente', async () => {
    setCuratedItem({
      ...BASE_ITEM,
      source_platform: 'seasonal',
      score_breakdown: { category: 'seasonal', pillar: 'seasonal', seasonal_slug: 'dia-das-maes' },
      source_content: 'DATA COMEMORATIVA: Dia das Mães\nÂNGULO EDITORIAL OBRIGATÓRIO (fio condutor do post, não fuja dele): Legado energético para as próximas gerações',
    })

    await agent.execute(makeCtx())

    expect(mockGenerateSimpleText).toHaveBeenCalled()
    const { userMessage } = mockGenerateSimpleText.mock.calls[0][0]
    expect(userMessage).toContain('CATEGORIA DETECTADA: seasonal')
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: FEATURED_WORKSPACE_ID,
        target_platform: 'instagram',
        target_format: 'feed_post',
      }),
    )
  })

  it('REGRESSÃO 08/07/2026: RESTRIÇÃO OBRIGATÓRIA (ex.: Finados, sem CTA comercial) chega ao prompt do writer com a exceção que anula o CTA do framework', async () => {
    setCuratedItem({
      ...BASE_ITEM,
      source_platform: 'seasonal',
      score_breakdown: { category: 'seasonal', pillar: 'seasonal', seasonal_slug: 'finados' },
      source_content:
        'DATA COMEMORATIVA: Finados\nÂNGULO EDITORIAL OBRIGATÓRIO (fio condutor do post, não fuja dele): Homenagem silenciosa\nRESTRIÇÃO OBRIGATÓRIA: Homenagem sem pauta comercial — sem venda, sem CTA de contato, sem menção a produto ou parceria.',
    })

    await agent.execute(makeCtx())

    const { systemPrompt, userMessage } = mockGenerateSimpleText.mock.calls[0][0]
    expect(userMessage).toContain('RESTRIÇÃO OBRIGATÓRIA')
    // A exceção precisa estar no systemPrompt para o writer saber ignorar o CTA "obrigatório" do framework de carousel/feed_post.
    expect(systemPrompt).toContain('EXCEÇÃO QUE ANULA O FRAMEWORK ABAIXO')
    expect(systemPrompt).toContain('proibindo CTA comercial')
  })

  it('item video-eligible de notícia (qualquer source_platform) ainda vira reel — comportamento preservado', async () => {
    mockGenerateSimpleText.mockResolvedValue({
      text: JSON.stringify({ format: 'reel', slides: [{ text: 'HOOK', duration: 3, style: 'bold-center' }], caption: 'Cap #x', image_prompts: ['p'] }),
      tokensUsed: 100,
    })
    setCuratedItem({
      ...BASE_ITEM,
      source_platform: 'x',
      source_content: 'video sobre EV',
      source_metrics: { reel_eligible: true, video_url: 'https://video.example.com/v.mp4' },
    })

    await agent.execute(makeCtx())

    expect(mockGenerateSimpleText).toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_platform: 'instagram',
        target_format: 'reel',
      }),
    )
  })

  it('item video-eligible do YouTube também vira reel — YouTube não é mais forçado a carousel', async () => {
    mockGenerateSimpleText.mockResolvedValue({
      text: JSON.stringify({ format: 'reel', slides: [{ text: 'HOOK', duration: 3, style: 'bold-center' }], caption: 'Cap #x', image_prompts: ['p'] }),
      tokensUsed: 100,
    })
    setCuratedItem({
      ...BASE_ITEM,
      source_platform: 'youtube',
      source_content: 'video do youtube sobre EV',
      source_metrics: { reel_eligible: true, video_url: 'https://video.example.com/v.mp4' },
    })

    await agent.execute(makeCtx())

    expect(mockGenerateSimpleText).toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        target_platform: 'instagram',
        target_format: 'reel',
      }),
    )
  })
})
