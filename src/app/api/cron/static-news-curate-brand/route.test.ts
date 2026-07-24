import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/settings/load-settings', () => ({
  getNumericVariable: vi.fn().mockImplementation((_wid: string, key: string) => {
    const defaults: Record<string, number> = {
      reel_min_relevance_score: 20,
      reel_lookback_hours: 72,
      reel_candidate_limit: 20,
    }
    return Promise.resolve(defaults[key] ?? null)
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

vi.mock('@/lib/pipeline/brand-static-visual', () => ({
  refineStaticNewsCandidateMedia: vi.fn(async (item: unknown) => item),
}))

describe('static-news-curate-brand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('enfileira noticia estatica elegivel com imagem curada', async () => {
    const inserted: unknown[] = []
    const fromMock = vi.fn((table: string) => {
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'curated-1',
              workspace_id: '00000000-0000-0000-0000-000000000000',
              source_platform: 'x',
              source_url: 'https://x.com/post/1',
              source_author: 'evnews',
              source_content: 'BYD chega ao Brasil com novo híbrido plug-in e preço no Brasil já definido para início de vendas no segundo semestre',
              source_metrics: {
                media_urls: ['https://cdn.example.com/byd.jpg'],
                media_types: ['image'],
              },
              relevance_score: 88,
            }],
          }),
        }
      }
      if (table === 'instagram_static_news_queue') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          insert: vi.fn((payload: unknown) => {
            inserted.push(payload)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    const { getAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock } as never)

    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/static-news-curate-brand') as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.queued).toBe(1)
    expect(inserted).toHaveLength(1)
    expect((inserted[0] as Record<string, unknown>).media_mode).toBe('curated_image')
  })

  it('nao duplica item ja enfileirado', async () => {
    const fromMock = vi.fn((table: string) => {
      if (table === 'curated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'curated-1',
              workspace_id: '00000000-0000-0000-0000-000000000000',
              source_platform: 'x',
              source_url: 'https://x.com/post/1',
              source_author: 'evnews',
              source_content: 'BYD chega ao Brasil com novo híbrido plug-in e preço no Brasil já definido para início de vendas no segundo semestre',
              source_metrics: {
                media_urls: ['https://cdn.example.com/byd.jpg'],
                media_types: ['image'],
              },
              relevance_score: 88,
            }],
          }),
        }
      }
      if (table === 'instagram_static_news_queue') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'queue-1' } }),
          insert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    const { getAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock } as never)

    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/static-news-curate-brand') as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.queued).toBe(0)
    expect(body.skippedReasons.duplicate).toBe(1)
  })
})
