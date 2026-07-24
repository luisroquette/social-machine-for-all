import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockEq = vi.fn(() => Promise.resolve({ data: [], error: null }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockFrom = vi.fn(() => ({ select: mockSelect }))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFrom }),
}))

beforeEach(() => {
  vi.resetModules()
  mockFrom.mockClear()
})

describe('evergreen_pillar_cursor setting', () => {
  it('está registrado na categoria pipeline com default "0"', async () => {
    const { VARIABLE_DEFINITIONS } = await import('./load-settings')
    const def = VARIABLE_DEFINITIONS.find(d => d.key === 'evergreen_pillar_cursor')
    expect(def).toBeDefined()
    expect(def?.category).toBe('pipeline')
    expect(def?.defaultValue).toBe('0')
  })

  it('getVariable retorna "0" quando não configurado no banco', async () => {
    const { getVariable } = await import('./load-settings')
    const value = await getVariable('11111111-1111-4111-8111-111111111111', 'evergreen_pillar_cursor')
    expect(value).toBe('0')
  })

  it('owned_x_handles já nasce com aliases same-owner protegidos', async () => {
    const { getVariable } = await import('./load-settings')
    const value = await getVariable('11111111-1111-4111-8111-111111111111', 'owned_x_handles')
    expect(value).toBe('luisroquette,example_handle')
  })
})

describe('autoreply_muted_media_ids setting (media-mute durável)', () => {
  it('registrado com default vazio (nada mutado por padrão)', async () => {
    const { VARIABLE_DEFINITIONS } = await import('./load-settings')
    const def = VARIABLE_DEFINITIONS.find(d => d.key === 'autoreply_muted_media_ids')
    expect(def).toBeDefined()
    expect(def?.defaultValue).toBe('')
  })

  it('getVariable retorna "" quando a chave está ausente', async () => {
    const { getVariable } = await import('./load-settings')
    const v = await getVariable('11111111-1111-4111-8111-111111111111', 'autoreply_muted_media_ids')
    expect(v).toBe('')
  })
})

describe('comment_daily_reply_cap setting (anti-ban configurável por workspace)', () => {
  it('registrado em rate_limits com default "80" e tipo number', async () => {
    const { VARIABLE_DEFINITIONS } = await import('./load-settings')
    const def = VARIABLE_DEFINITIONS.find(d => d.key === 'comment_daily_reply_cap')
    expect(def).toBeDefined()
    expect(def?.category).toBe('rate_limits')
    expect(def?.defaultValue).toBe('80')
    expect(def?.type).toBe('number')
  })

  // Regra do Gate: chave ausente DEVE herdar o comportamento legado (cap 80),
  // nunca virar 0/desabilitado silenciosamente.
  it('getNumericVariable herda 80 quando a chave está ausente no banco', async () => {
    const { getNumericVariable } = await import('./load-settings')
    const cap = await getNumericVariable('11111111-1111-4111-8111-111111111111', 'comment_daily_reply_cap')
    expect(cap).toBe(80)
  })
})
