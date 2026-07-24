/**
 * REGRESSÃO: calendário editorial de datas comemorativas do @brand
 * (docs/superpowers/specs — calendário enviado 08/07/2026).
 *
 * As datas móveis (Carnaval, Cinzas, Páscoa, Corpus Christi) são calculadas a
 * partir do Domingo de Páscoa em runtime, não hardcoded por ano — o algoritmo
 * precisa estar correto para qualquer ano em que o cron rodar.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublishMarketingAssetRow = vi.fn()
vi.mock('@/lib/pipeline/brand-marketing-assets', () => ({
  publishMarketingAssetRow: (...args: unknown[]) => mockPublishMarketingAssetRow(...args),
}))

let seasonalDatesRows: unknown[] = []
let pinnedAssetForSlug: Record<string, unknown> = {}
const curatedContentInserts: Array<Record<string, unknown>> = []
const lastUsedYearUpdates: Array<{ id: string; last_used_year: number }> = []

const mockFromFn = vi.fn((table: string) => {
  if (table === 'brand_seasonal_dates') {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            or: () => Promise.resolve({ data: seasonalDatesRows, error: null }),
          }),
        }),
      }),
      update: (patch: { last_used_year: number }) => ({
        eq: (_col: string, id: string) => {
          lastUsedYearUpdates.push({ id, last_used_year: patch.last_used_year })
          return Promise.resolve({ error: null })
        },
      }),
    }
  }
  if (table === 'brand_marketing_assets') {
    return {
      select: () => ({
        eq: () => ({
          eq: (_col: string, slug: string) => ({
            is: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve({ data: pinnedAssetForSlug[slug] ?? null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    }
  }
  if (table === 'curated_content') {
    return {
      insert: (payload: Record<string, unknown>) => {
        curatedContentInserts.push(payload)
        return Promise.resolve({ error: null })
      },
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({ from: mockFromFn }),
}))

import { computeEasterSunday, resolveOccurrenceDate, runSeasonalBrand } from './brand-seasonal-dates'

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'row-1',
    slug: 'dia-das-maes',
    name: 'Dia das Mães',
    month: 5,
    day: 10,
    easter_offset_days: null,
    angle: 'Legado energético para as próximas gerações',
    is_priority: true,
    restriction_notes: null,
    last_used_year: null,
    ...overrides,
  }
}

describe('REGRESSÃO: cálculo do Domingo de Páscoa', () => {
  // Datas historicamente corretas — não alterar sem verificar contra um calendário eclesiástico real.
  const knownEasterSundays: Array<[number, number, number]> = [
    [2024, 3, 31],
    [2025, 4, 20],
    [2026, 4, 5],
    [2027, 3, 28],
    [2028, 4, 16],
  ]

  for (const [year, month, day] of knownEasterSundays) {
    it(`Páscoa ${year} = ${month}/${day}`, () => {
      expect(computeEasterSunday(year)).toEqual({ month, day })
    })
  }
})

describe('REGRESSÃO: datas móveis derivadas da Páscoa (ano 2026)', () => {
  const year = 2026

  it('Domingo de Páscoa (offset 0) = 05/04/2026', () => {
    const d = resolveOccurrenceDate({ month: null, day: null, easter_offset_days: 0 }, year)
    expect(d.getUTCMonth() + 1).toBe(4)
    expect(d.getUTCDate()).toBe(5)
  })

  it('Corpus Christi (offset +60) = 04/06/2026', () => {
    const d = resolveOccurrenceDate({ month: null, day: null, easter_offset_days: 60 }, year)
    expect(d.getUTCMonth() + 1).toBe(6)
    expect(d.getUTCDate()).toBe(4)
  })

  it('Carnaval — Terça (offset -47) = 17/02/2026', () => {
    const d = resolveOccurrenceDate({ month: null, day: null, easter_offset_days: -47 }, year)
    expect(d.getUTCMonth() + 1).toBe(2)
    expect(d.getUTCDate()).toBe(17)
  })

  it('Quarta-feira de Cinzas (offset -46) = 18/02/2026', () => {
    const d = resolveOccurrenceDate({ month: null, day: null, easter_offset_days: -46 }, year)
    expect(d.getUTCMonth() + 1).toBe(2)
    expect(d.getUTCDate()).toBe(18)
  })
})

describe('REGRESSÃO: datas fixas passam através sem depender da Páscoa', () => {
  it('Natal (25/12) resolve para 25/12 em qualquer ano', () => {
    const d = resolveOccurrenceDate({ month: 12, day: 25, easter_offset_days: null }, 2030)
    expect(d.getUTCMonth() + 1).toBe(12)
    expect(d.getUTCDate()).toBe(25)
  })
})

describe('runSeasonalBrand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seasonalDatesRows = []
    pinnedAssetForSlug = {}
    curatedContentInserts.length = 0
    lastUsedYearUpdates.length = 0
    mockPublishMarketingAssetRow.mockResolvedValue({ success: true, assetId: 'asset-1', postUrl: 'https://instagram.com/p/xyz' })
  })

  it('data ★ (is_priority) sem asset fixado semeia curated_content com relevance_score 150', async () => {
    seasonalDatesRows = [makeRow({ is_priority: true })]

    const results = await runSeasonalBrand(WORKSPACE_ID, new Date('2026-05-10T12:00:00Z'))

    expect(results).toEqual([{ slug: 'dia-das-maes', action: 'seeded_ai' }])
    expect(curatedContentInserts).toEqual([
      expect.objectContaining({
        source_platform: 'seasonal',
        relevance_score: 150,
        score_breakdown: { category: 'seasonal', pillar: 'seasonal', seasonal_slug: 'dia-das-maes' },
      }),
    ])
  })

  it('REGRESSÃO 08/07/2026: data não-prioritária sem asset fixado usa relevance_score 100 (nunca 150)', async () => {
    seasonalDatesRows = [makeRow({ slug: 'aniversario-sp', is_priority: false })]

    await runSeasonalBrand(WORKSPACE_ID, new Date('2026-05-10T12:00:00Z'))

    expect(curatedContentInserts).toEqual([expect.objectContaining({ relevance_score: 100 })])
  })

  it('data com asset fixado publica direto e NÃO semeia curated_content', async () => {
    seasonalDatesRows = [makeRow()]
    pinnedAssetForSlug['dia-das-maes'] = { id: 'asset-1', public_url: 'https://x/img.png', caption: 'legenda', pillar: 'seasonal' }

    const results = await runSeasonalBrand(WORKSPACE_ID, new Date('2026-05-10T12:00:00Z'))

    expect(mockPublishMarketingAssetRow).toHaveBeenCalledWith(expect.anything(), WORKSPACE_ID, pinnedAssetForSlug['dia-das-maes'])
    expect(curatedContentInserts).toEqual([])
    expect(results).toEqual([{ slug: 'dia-das-maes', action: 'published_asset', detail: 'https://instagram.com/p/xyz' }])
  })

  it('marca last_used_year no ano corrente para toda ocasião processada (asset ou IA)', async () => {
    seasonalDatesRows = [makeRow()]

    await runSeasonalBrand(WORKSPACE_ID, new Date('2026-05-10T12:00:00Z'))

    expect(lastUsedYearUpdates).toEqual([{ id: 'row-1', last_used_year: 2026 }])
  })

  it('ocasião que não cai hoje é ignorada — nenhum insert, nenhuma publicação, nenhum update', async () => {
    seasonalDatesRows = [makeRow()] // dia-das-maes é 10/05

    await runSeasonalBrand(WORKSPACE_ID, new Date('2026-06-01T12:00:00Z'))

    expect(curatedContentInserts).toEqual([])
    expect(mockPublishMarketingAssetRow).not.toHaveBeenCalled()
    expect(lastUsedYearUpdates).toEqual([])
  })

  it('restriction_notes entra na FONTE injetada no writer quando presente', async () => {
    seasonalDatesRows = [makeRow({ slug: 'finados', month: 11, day: 2, is_priority: false, restriction_notes: 'sem CTA comercial' })]

    await runSeasonalBrand(WORKSPACE_ID, new Date('2026-11-02T12:00:00Z'))

    expect(curatedContentInserts[0].source_content).toContain('RESTRIÇÃO OBRIGATÓRIA: sem CTA comercial')
  })
})
