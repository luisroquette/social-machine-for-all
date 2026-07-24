import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetVariable = vi.fn()
const mockUpdateSetting = vi.fn(() => Promise.resolve())
vi.mock('@/lib/settings/load-settings', () => ({
  getVariable: mockGetVariable,
  updateSetting: mockUpdateSetting,
}))

let mockFacts: Array<{ id: string; fact: string; source: string; used_count: number }> = []
let insertedPayload: any = null
const factUpdates: Array<{ id: string; used_count: number }> = []

const mockFrom = vi.fn((table: string) => {
  if (table === 'brand_pillar_facts') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: mockFacts, error: null }),
              }),
            }),
          }),
        }),
      }),
      update: (payload: { used_count: number }) => ({
        eq: (_col: string, id: string) => {
          factUpdates.push({ id, used_count: payload.used_count })
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }
  }
  if (table === 'curated_content') {
    return {
      insert: (payload: any) => {
        insertedPayload = payload
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'curated-item-1' }, error: null }),
          }),
        }
      },
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFrom }),
}))

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

beforeEach(() => {
  vi.resetModules()
  mockFrom.mockClear()
  mockGetVariable.mockReset()
  mockUpdateSetting.mockReset().mockResolvedValue(undefined)
  insertedPayload = null
  factUpdates.length = 0
  mockFacts = [
    { id: 'fact-1', fact: 'Fato um', source: 's1', used_count: 0 },
    { id: 'fact-2', fact: 'Fato dois', source: 's2', used_count: 0 },
  ]
})

describe('seedEvergreenPillarItem', () => {
  it('usa o pilar do cursor atual (cursor "0" → "dor")', async () => {
    mockGetVariable.mockResolvedValue('0')
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    const result = await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(result?.pillar).toBe('dor')
    expect(insertedPayload.source_content).toContain('Fato um')
    expect(insertedPayload.source_content).toContain('Fato dois')
  })

  it('REGRESSÃO: score_breakdown.category nunca fica vazio — senão o writer nunca vê o item (NULL NOT IN é NULL)', async () => {
    mockGetVariable.mockResolvedValue('0')
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(insertedPayload.score_breakdown).toBeDefined()
    expect(insertedPayload.score_breakdown.category).toBeTruthy()
    expect(['noise', 'opinion']).not.toContain(insertedPayload.score_breakdown.category)
  })

  it('insere com source_platform=pillar, status=curated e relevance_score alto', async () => {
    mockGetVariable.mockResolvedValue('0')
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(insertedPayload.workspace_id).toBe(WORKSPACE_ID)
    expect(insertedPayload.source_platform).toBe('pillar')
    expect(insertedPayload.status).toBe('curated')
    expect(insertedPayload.relevance_score).toBeGreaterThanOrEqual(90)
  })

  it('avança o cursor em 1 após o seed (0 → 1)', async () => {
    mockGetVariable.mockResolvedValue('0')
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(mockUpdateSetting).toHaveBeenCalledWith(WORKSPACE_ID, 'pipeline', 'evergreen_pillar_cursor', '1')
  })

  it('cursor "6" (generico, último pilar) faz wrap para "0"', async () => {
    mockGetVariable.mockResolvedValue('6')
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    const result = await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(result?.pillar).toBe('generico')
    expect(mockUpdateSetting).toHaveBeenCalledWith(WORKSPACE_ID, 'pipeline', 'evergreen_pillar_cursor', '0')
  })

  it('incrementa used_count dos fatos usados', async () => {
    mockGetVariable.mockResolvedValue('0')
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(factUpdates).toEqual(
      expect.arrayContaining([
        { id: 'fact-1', used_count: 1 },
        { id: 'fact-2', used_count: 1 },
      ]),
    )
  })

  it('retorna null e não avança o cursor quando não há fatos para o pilar', async () => {
    mockGetVariable.mockResolvedValue('0')
    mockFacts = []
    const { seedEvergreenPillarItem } = await import('./brand-evergreen-pillars')

    const result = await seedEvergreenPillarItem(WORKSPACE_ID)

    expect(result).toBeNull()
    expect(mockUpdateSetting).not.toHaveBeenCalled()
    expect(insertedPayload).toBeNull()
  })
})
