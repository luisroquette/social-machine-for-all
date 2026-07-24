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

const mockSelectSingle = vi.fn()
const mockUpdateEq = vi.fn()
const mockDeleteEq = vi.fn()
const mockInsert = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'engagement_profiles') throw new Error(`Unexpected table ${table}`)
      return {
        select: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
        insert: mockInsert,
        update: () => ({ eq: () => ({ eq: mockUpdateEq }) }),
        delete: () => ({ eq: () => ({ eq: mockDeleteEq }) }),
      }
    },
  }),
}))

import { DELETE, POST, PUT } from './route'

describe('/api/settings/engagement-profiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInsert.mockReturnValue({
      select: () => ({
        single: mockSelectSingle,
      }),
    })
    mockSelectSingle.mockResolvedValue({
      data: {
        id: 'profile-1',
        handle: 'usuario_externo',
        platform: 'x',
        active: true,
        config: { max_daily_interactions: 3 },
      },
      error: null,
    })
    mockUpdateEq.mockResolvedValue({ error: null })
    mockDeleteEq.mockResolvedValue({ error: null })
  })

  it('bloqueia cadastro de handle same-owner', async () => {
    const res = await POST(new Request('https://app.test/api/settings/engagement-profiles', {
      method: 'POST',
      body: JSON.stringify({ handle: '@LuisRoquette', platform: 'x' }),
      headers: { 'Content-Type': 'application/json' },
    }))

    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body.error).toMatch(/same-owner/)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('permite cadastro de handle externo e normaliza metadata base', async () => {
    const res = await POST(new Request('https://app.test/api/settings/engagement-profiles', {
      method: 'POST',
      body: JSON.stringify({ handle: '@Usuario_Externo', platform: 'x', max_daily_interactions: 5 }),
      headers: { 'Content-Type': 'application/json' },
    }))

    expect(res.status).toBe(201)
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
      handle: 'usuario_externo',
      platform: 'x',
      active: true,
      config: { max_daily_interactions: 5 },
    }))
  })

  it('atualiza active/max_daily_interactions', async () => {
    const res = await PUT(new Request('https://app.test/api/settings/engagement-profiles', {
      method: 'PUT',
      body: JSON.stringify({ id: 'profile-1', active: false, max_daily_interactions: 4 }),
      headers: { 'Content-Type': 'application/json' },
    }))

    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockUpdateEq).toHaveBeenCalled()
  })

  it('remove profile por id', async () => {
    const res = await DELETE(new Request('https://app.test/api/settings/engagement-profiles?id=profile-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(mockDeleteEq).toHaveBeenCalled()
  })
})
