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
  parseAIJson: vi.fn((text: string) => JSON.parse(text)),
}))

const mockInsert = vi.fn().mockResolvedValue({ error: null })
const mockDeactivateEq = vi.fn().mockResolvedValue({ error: null })

let mockProfiles: Array<{
  id: string
  handle: string
  platform: string
  config: Record<string, unknown> | null
  last_engaged_at: string | null
}> = []

let mockCuratedContent: Array<{ source_content: string; relevance_score: number }> = []
let mockTodayCount = 0

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table === 'engagement_profiles') {
        const chain = {
          eq: () => chain,
          then: (resolve: (value: { data: typeof mockProfiles; error: null }) => unknown) => (
            Promise.resolve({ data: mockProfiles, error: null }).then(resolve)
          ),
        }
        return {
          select: () => chain,
          update: () => ({ eq: () => ({ eq: mockDeactivateEq }) }),
        }
      }

      if (table === 'curated_content') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => Promise.resolve({ data: mockCuratedContent, error: null }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'engagement_actions') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  gte: () => Promise.resolve({ count: mockTodayCount, error: null }),
                }),
              }),
            }),
          }),
          insert: mockInsert,
        }
      }

      throw new Error(`Unexpected table ${table}`)
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

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

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

describe('engagement-external — same-owner and thread metadata guardrails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProfiles = []
    mockCuratedContent = []
    mockTodayCount = 0
    mockedLoadSettings.mockResolvedValue({
      own_twitter_handle: 'thedoomguy_ai',
      target_handle: 'example_handle',
    } as Awaited<ReturnType<typeof loadSettings>>)
    mockedGetVariable.mockImplementation(async (_workspaceId: string, key: string) => {
      if (key === 'twitter_handle') return 'example_handle'
      if (key === 'owned_x_handles') return 'luisroquette'
      return 'deepseek-chat'
    })
    mockedGenerateSimpleText.mockResolvedValue({
      text: '{"comment":"Testei algo parecido em produção e o gargalo virou latência de tool-calling.","style":"opiniao_tecnica"}',
      tokensUsed: 120,
    } as Awaited<ReturnType<typeof generateSimpleText>>)
    mockDeactivateEq.mockResolvedValue({ error: null })
  })

  it('bloqueia perfil same-owner antes de prospectar tweet', async () => {
    mockProfiles = [
      { id: '1', handle: 'LuisRoquette', platform: 'x', config: null, last_engaged_at: null },
    ]

    const result = await agent.execute(makeCtx())

    expect(result.itemsProduced).toBe(0)
    expect((result.details as { sameOwnerSkipped?: number }).sameOwnerSkipped).toBe(1)
    expect((result.details as { sameOwnerReconciled?: number }).sameOwnerReconciled).toBe(1)
    expect(mockDeactivateEq).toHaveBeenCalled()
    expect(mockedSearchTweetsIO).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('persiste thread metadata ao enfileirar comentário externo', async () => {
    mockProfiles = [
      { id: '2', handle: 'usuario_externo', platform: 'x', config: null, last_engaged_at: null },
    ]
    mockCuratedContent = [{ source_content: 'contexto IA', relevance_score: 90 }]
    mockedSearchTweetsIO.mockResolvedValue([
      {
        id: '777',
        url: 'https://x.com/usuario_externo/status/777',
        text: 'Post técnico',
        author: 'usuario_externo',
        conversationId: 'conv-777',
        inReplyToId: 'parent-777',
        inReplyToUsername: null,
        metrics: { likes: 1, retweets: 0, replies: 0, views: 10 },
        createdAt: new Date().toISOString(),
      },
    ])

    const result = await agent.execute(makeCtx())

    expect(result.itemsProduced).toBe(1)
    expect(mockInsert).toHaveBeenCalledOnce()

    const payload = mockInsert.mock.calls[0]?.[0] as {
      target_author: string
      metadata: Record<string, unknown>
    }

    expect(payload.target_author).toBe('usuario_externo')
    expect(payload.metadata.conversation_id).toBe('conv-777')
    expect(payload.metadata.thread_id).toBe('conv-777')
    expect(payload.metadata.target_tweet_id).toBe('777')
    expect(payload.metadata.pair_id).toBe('thedoomguy_ai:usuario_externo')
    expect((payload.metadata.guardrail as { version?: string }).version).toBe('v2')
  })
})
