/**
 * TESTE DE REGRESSÃO — executor anti-self-engagement
 *
 * Bug confirmado em 2026-04-30: 50+ ações pending contra @your_ai_profile
 * na tabela engagement_actions. O executor processava a fila cegamente,
 * sem verificar se a ação era direcionada ao próprio handle.
 *
 * Fix: executor carrega own_twitter_handle e descarta qualquer ação cujo
 * target_url contenha /{ownHandle}/ antes de executar no Twitter.
 *
 * Se este teste falhar → o executor voltou a executar self-engagement.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadSettings } from '@/lib/settings/load-settings'

const OWN_HANDLE = 'your_ai_profile'
const NOON_UTC = new Date('2026-04-30T12:00:00Z') // fora do quiet hours (00-08 UTC)

// ── Mocks (devem usar literais, não variáveis — vi.mock é hoisted) ──

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: () => true,
}))

vi.mock('@/lib/config/workspace', () => ({
  WORKSPACE_ID: '11111111-1111-4111-8111-111111111111',
}))

vi.mock('@/lib/settings/load-settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({ own_twitter_handle: 'your_ai_profile' }),
  getVariable: vi.fn(async (_workspaceId: string, key: string) => {
    if (key === 'twitter_handle') return 'example_handle'
    if (key === 'owned_x_handles') return 'example_owner'
    return ''
  }),
}))

vi.mock('@/lib/platforms/x/twitterapi-io', () => ({
  searchTweetsIO: vi.fn().mockResolvedValue([]),
}))

const mockReply = vi.fn().mockResolvedValue({ success: true, postUrl: 'https://x.com/i/status/999', postId: '999' })
const mockLike = vi.fn().mockResolvedValue(true)
const mockRetweet = vi.fn().mockResolvedValue(true)

vi.mock('@/lib/platforms/x/client', () => ({
  XClient: {
    fromEnv: () => ({ reply: mockReply, like: mockLike, retweet: mockRetweet }),
  },
}))

// Supabase mock com controle sobre ações retornadas e rastreamento de updates
const mockUpdate = vi.fn()
let mockActions: Array<{
  id: string
  action_type: string
  target_platform: string
  target_url: string | null
  target_author: string | null
  comment_text: string | null
  metadata?: Record<string, unknown> | null
}> = []

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation(() => Promise.resolve({ data: mockActions, error: null })),
      }),
      update: mockUpdate,
    }),
  }),
}))

import { GET } from './route'

// ── Helpers ──

function makeRequest() {
  return new Request('https://app.com/api/cron/engagement-executor')
}

function makeUpdateEqChain() {
  return { eq: vi.fn().mockResolvedValue({ error: null }) }
}

function makeSelfAction(id: string, actionType = 'comment') {
  return {
    id,
    action_type: actionType,
    target_platform: 'x',
    target_url: `https://x.com/${OWN_HANDLE}/status/${id}`,
    target_author: OWN_HANDLE,
    comment_text: 'Auto-reply que nunca deveria ser executado',
    metadata: { guardrail: { version: 'v2' } },
  }
}

function makeExternalAction(id: string, actionType = 'comment') {
  return {
    id,
    action_type: actionType,
    target_platform: 'x',
    target_url: `https://x.com/usuario_externo/status/${id}`,
    target_author: 'usuario_externo',
    comment_text: 'Reply para terceiro — deve ser executado',
    metadata: { guardrail: { version: 'v2' } },
  }
}

function makeSameOwnerAliasAction(id: string, actionType = 'comment') {
  return {
    id,
    action_type: actionType,
    target_platform: 'x',
    target_url: `https://x.com/example_owner/status/${id}`,
    target_author: 'example_owner',
    comment_text: 'Isso também precisa ser bloqueado',
    metadata: { guardrail: { version: 'v2' } },
  }
}

// ── Testes ──

describe('engagement-executor — guardrail anti-self-engagement', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOON_UTC) // garante que não está em quiet hours (00-08 UTC)
    vi.clearAllMocks()
    mockActions = []
    mockUpdate.mockReturnValue(makeUpdateEqChain())
    mockReply.mockResolvedValue({ success: true, postUrl: 'https://x.com/i/status/999', postId: '999' })
    mockLike.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('REGRESSÃO: bloqueia comment direcionado ao próprio handle', async () => {
    mockActions = [makeSelfAction('111', 'comment')]

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.executed).toBe(0)
    expect(body.failed).toBe(1)

    const updatePayload = mockUpdate.mock.calls[0]?.[0]
    expect(updatePayload?.status).toBe('failed')
    expect(updatePayload?.metadata?.reason).toMatch(/same-owner engagement bloqueado/)
  })

  it('REGRESSÃO: bloqueia like direcionado ao próprio handle', async () => {
    mockActions = [makeSelfAction('222', 'like')]

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.executed).toBe(0)
    expect(body.failed).toBe(1)

    const updatePayload = mockUpdate.mock.calls[0]?.[0]
    expect(updatePayload?.status).toBe('failed')
    expect(updatePayload?.metadata?.reason).toMatch(/same-owner engagement bloqueado/)
  })

  it('REGRESSÃO: handle com @ no settings é normalizado corretamente', async () => {
    vi.mocked(loadSettings).mockResolvedValue({ own_twitter_handle: `@${OWN_HANDLE}` } as Awaited<ReturnType<typeof loadSettings>>)

    mockActions = [makeSelfAction('333', 'comment')]

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.executed).toBe(0)
    expect(body.failed).toBe(1)
  })

  it('positivo: executa normalmente ação direcionada a terceiro', async () => {
    mockActions = [makeExternalAction('444', 'comment')]

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.executed).toBe(1)
    expect(body.failed).toBe(0)
    expect(mockReply).toHaveBeenCalledOnce()
    const updatePayload = mockUpdate.mock.calls[0]?.[0]
    expect(updatePayload?.metadata?.guardrail?.version).toBe('v2')
  })

  it('mix: bloqueia ações próprias, executa terceiros', async () => {
    mockActions = [
      makeSelfAction('555', 'comment'),  // bloqueado
      makeExternalAction('666', 'comment'), // executado
      makeSelfAction('777', 'like'),     // bloqueado
    ]

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.executed).toBe(1)
    expect(body.failed).toBe(2)
    expect(mockReply).toHaveBeenCalledOnce()
  })

  it('REGRESSÃO: bloqueia alias same-owner @example_owner já enfileirado', async () => {
    mockActions = [makeSameOwnerAliasAction('888', 'comment')]

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(body.executed).toBe(0)
    expect(body.failed).toBe(1)
    expect(mockReply).not.toHaveBeenCalled()

    const updatePayload = mockUpdate.mock.calls[0]?.[0]
    expect(updatePayload?.status).toBe('failed')
    expect(updatePayload?.metadata?.reason).toMatch(/same-owner engagement bloqueado/)
  })
})
