/**
 * TESTE DE REGRESSÃO — anti-self-engagement guardrail
 *
 * Por que este teste existe:
 * Em Abr/2026, o agente engagement-own começou a responder os próprios posts do
 * @thedoomguy_ai como se fossem comentários de terceiros.
 * A causa: o filtro `-from:handle` da API do Twitter pode falhar quando `ownHandle`
 * inclui `@` no valor — e não havia verificação em código.
 *
 * Fix aplicado: dupla verificação hardcoded em `execute()`:
 *   1. `reply.author === ownHandle` (normalizado)
 *   2. `reply.url.includes('/${ownHandle}/')` (fallback via URL)
 *
 * Este teste garante que o fix nunca seja removido silenciosamente.
 * Se este teste falhar, o bug voltou.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/platforms/x/twitterapi-io', () => ({
  searchTweetsIO: vi.fn(),
}))

vi.mock('@/lib/settings/load-settings', () => ({
  loadSettings: vi.fn(),
  getVariable: vi.fn(),
}))

vi.mock('@/lib/ai/tool-loop', () => ({
  generateSimpleText: vi.fn(),
}))

vi.mock('@/lib/ai/parse-json', () => ({
  parseAIJson: vi.fn(),
}))

const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockCount = vi.fn().mockResolvedValue({ count: 0, error: null })

type CountResult = { count: number; error: null }
type UpdateResult = { error: null }

interface MockChain extends PromiseLike<CountResult> {
  select(): MockChain
  eq(): MockChain
  in(): MockChain
  gte(): MockChain
  ilike(): MockChain
  order(): MockChain
  limit(): MockChain
  insert: typeof mockInsert
  update(): { eq(): Promise<UpdateResult> }
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => {
      const chain: MockChain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        gte: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve) => mockCount().then(resolve),
        insert: mockInsert,
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }
      return chain
    },
  }),
}))

import { generateSimpleText } from '@/lib/ai/tool-loop'
import { getVariable, loadSettings } from '@/lib/settings/load-settings'
import { searchTweetsIO } from '@/lib/platforms/x/twitterapi-io'
import { agent } from './index'

const mockedSearchTweetsIO = vi.mocked(searchTweetsIO)
const mockedLoadSettings = vi.mocked(loadSettings)
const mockedGetVariable = vi.mocked(getVariable)
const mockedGenerateSimpleText = vi.mocked(generateSimpleText)

const OWN_HANDLE = 'thedoomguy_ai'
const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

function makeCtx(): Parameters<typeof agent.execute>[0] {
  return {
    workspaceId: WORKSPACE_ID,
    settings: {},
    brandContext: 'test brand',
    feedbackContext: '',
    pipelineRunId: 'test-run',
    dbConfig: { model: 'deepseek-chat', temperature: 0.8 },
  } as Parameters<typeof agent.execute>[0]
}

function makeTweet(author: string, id = '111') {
  return {
    id,
    text: `Tweet de @${author} sobre IA`,
    author,
    url: `https://x.com/${author}/status/${id}`,
    conversationId: `conv-${id}`,
    inReplyToId: `parent-${id}`,
    inReplyToUsername: OWN_HANDLE,
    metrics: { likes: 0, retweets: 0, replies: 0, views: 0 },
    createdAt: new Date().toISOString(),
    mediaUrls: [],
  }
}

describe('engagement-own — guardrail anti-self-engagement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedLoadSettings.mockResolvedValue({ own_twitter_handle: OWN_HANDLE, target_handle: 'example_handle' } as Awaited<ReturnType<typeof loadSettings>>)
    mockedGetVariable.mockImplementation(async (_workspaceId: string, key: string) => {
      if (key === 'twitter_handle') return 'example_handle'
      if (key === 'owned_x_handles') return ''
      if (key === 'known_agent_x_handles') return ''
      return 'deepseek-chat'
    })
    mockedGenerateSimpleText.mockResolvedValue({
      text: '{"reply": "Ótimo ponto!", "style": "complemento"}',
      tokensUsed: 100,
    } as Awaited<ReturnType<typeof generateSimpleText>>)
  })

  it('REGRESSÃO: não insere nenhuma ação quando todos os replies são do próprio handle', async () => {
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet(OWN_HANDLE, '111'),
      makeTweet(OWN_HANDLE, '222'),
      makeTweet(OWN_HANDLE, '333'),
    ])

    await agent.execute(makeCtx())

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('REGRESSÃO: não insere quando o author vem com @ prefixado', async () => {
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet(`@${OWN_HANDLE}`, '444'),
    ])

    await agent.execute(makeCtx())

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('REGRESSÃO: não insere quando author é null mas URL contém o próprio handle', async () => {
    mockedSearchTweetsIO.mockResolvedValue([
      {
        ...makeTweet(OWN_HANDLE, '555'),
        author: null as unknown as string, // simula author ausente na resposta da API
        url: `https://x.com/${OWN_HANDLE}/status/555`,
      },
    ])

    await agent.execute(makeCtx())

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('REGRESSÃO: não insere com handle em maiúsculas (case-insensitive)', async () => {
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet('TheDoomGuy_AI', '666'),
    ])

    await agent.execute(makeCtx())

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('positivo: insere ação quando o reply é de um terceiro', async () => {
    mockCount.mockResolvedValue({ count: 0, error: null })
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet('usuario_externo', '777'),
    ])

    await agent.execute(makeCtx())

    expect(mockInsert).toHaveBeenCalled()
  })

  it('positivo: persiste target_author e snapshot do guardrail ao enfileirar reply', async () => {
    mockCount.mockResolvedValue({ count: 0, error: null })
    mockedGenerateSimpleText.mockResolvedValue({
      text: '{"reply": "Nos testes que rodamos, a latência subiu 18% com esse setup. Vocês mediram P95 também?", "style": "debate"}',
      tokensUsed: 120,
    } as Awaited<ReturnType<typeof generateSimpleText>>)
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet('usuario_externo', '777'),
    ])

    await agent.execute(makeCtx())

    const replyInsert = mockInsert.mock.calls
      .map(([payload]) => payload as Record<string, unknown>)
      .find(payload => payload.action_type === 'comment' && payload.comment_style !== 'cta')

    expect(replyInsert?.target_author).toBe('usuario_externo')
    expect((replyInsert?.metadata as { guardrail?: { version?: string } } | undefined)?.guardrail?.version).toBe('v2')
    expect((replyInsert?.metadata as { guardrail?: { hasNovelty?: boolean } } | undefined)?.guardrail?.hasNovelty).toBe(true)
    expect((replyInsert?.metadata as { thread_id?: string } | undefined)?.thread_id).toBe('conv-777')
    expect((replyInsert?.metadata as { conversation_id?: string } | undefined)?.conversation_id).toBe('conv-777')
  })

  it('mix: só insere para tweets de terceiros, nunca para os próprios', async () => {
    mockCount.mockResolvedValue({ count: 0, error: null })
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet(OWN_HANDLE, '888'),
      makeTweet('outro_usuario', '999'),
      makeTweet(OWN_HANDLE, '000'),
    ])

    await agent.execute(makeCtx())

    const insertUrls = mockInsert.mock.calls.map(([payload]) => {
      const row = payload as { target_url?: string | null }
      return row.target_url ?? ''
    })

    expect(insertUrls.some(url => url.includes(`/${OWN_HANDLE}/`))).toBe(false)
  })

  it('REGRESSÃO: não responde alias same-owner @luisroquette mesmo sem alternância prévia', async () => {
    mockedGetVariable.mockImplementation(async (_workspaceId: string, key: string) => {
      if (key === 'twitter_handle') return 'example_handle'
      if (key === 'owned_x_handles') return ''
      if (key === 'known_agent_x_handles') return ''
      return 'deepseek-chat'
    })
    mockedSearchTweetsIO.mockResolvedValue([
      makeTweet('luisroquette', '1010'),
    ])

    await agent.execute(makeCtx())

    expect(mockInsert).not.toHaveBeenCalled()
  })
})
