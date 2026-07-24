import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config/workspace', () => ({
  getActiveWorkspaceId: vi.fn().mockResolvedValue('workspace-1'),
}))

vi.mock('@/lib/settings/load-settings', () => ({
  loadSettings: vi.fn().mockResolvedValue({
    own_twitter_handle: 'thedoomguy_ai',
    target_handle: 'example_handle',
  }),
  getVariable: vi.fn(async (_workspaceId: string, key: string) => {
    if (key === 'twitter_handle') return 'example_handle'
    if (key === 'owned_x_handles') return 'luisroquette'
    return ''
  }),
}))

const mockDeactivateEq = vi.fn().mockResolvedValue({ error: null })
let mockProfiles = [
  { id: '1', handle: 'luisroquette', platform: 'x', active: true },
  { id: '2', handle: 'usuario_externo', platform: 'x', active: true },
]

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'engagement_profiles') throw new Error(`Unexpected table ${table}`)
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
    },
  }),
}))

import { POST } from './route'

describe('/api/settings/engagement-profiles/reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProfiles = [
      { id: '1', handle: 'luisroquette', platform: 'x', active: true },
      { id: '2', handle: 'usuario_externo', platform: 'x', active: true },
    ]
    mockDeactivateEq.mockResolvedValue({ error: null })
  })

  it('desativa perfis same-owner já existentes', async () => {
    const res = await POST()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.deactivatedCount).toBe(1)
    expect(body.handles).toEqual(['luisroquette'])
    expect(mockDeactivateEq).toHaveBeenCalled()
  })
})
