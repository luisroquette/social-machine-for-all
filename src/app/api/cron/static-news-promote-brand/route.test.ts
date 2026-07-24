import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: vi.fn().mockReturnValue(true),
}))

vi.mock('@/lib/settings/load-settings', () => ({
  getNumericVariable: vi.fn().mockResolvedValue(10),
}))

const mockGenerateTextWithFallback = vi.fn()
vi.mock('@/lib/ai/generate-with-fallback', () => ({
  generateTextWithFallback: (...args: unknown[]) => mockGenerateTextWithFallback(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: vi.fn(),
}))

describe('static-news-promote-brand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('promove draft com media curada para carousel', async () => {
    const inserts: unknown[] = []
    const updates: unknown[] = []
    mockGenerateTextWithFallback.mockResolvedValue(JSON.stringify({
      format: 'carousel',
      visual_mode: 'curated_image',
      eyebrow: 'VENDAS',
      image_prompt: 'premium electric sedan hero shot in brazilian dealership light, no text, no watermark',
      caption: 'Mais um EV competitivo no Brasil. O gargalo agora nao e carro. E infraestrutura. A Brand transforma demanda em operacao.',
      slides: [
        { type: 'cover', headline: 'EV NOVO, DEMANDA NOVA', context: 'Lancamento confirmado no Brasil', kpi: 'Inicio de vendas' },
        { type: 'content', headline: 'RECARGA VIRA GARGALO', body: 'Estacionamentos, varejo e frotas precisam se antecipar.', kpi: 'Operacao antes do pico' },
      ],
    }))

    const fromMock = vi.fn((table: string) => {
      if (table === 'instagram_static_news_queue') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'queue-1',
              curated_content_id: 'curated-1',
              workspace_id: '00000000-0000-0000-0000-000000000000',
              source_platform: 'x',
              source_url: 'https://x.com/post/1',
              source_author: 'evnews',
              source_content: 'BYD chega ao Brasil com novo híbrido plug-in e preço no Brasil já definido para início de vendas no segundo semestre',
              source_metrics: null,
              launch_category: 'sales_brazil',
              launch_score: 88,
              launch_reasons: ['brazil_confirmed'],
              media_mode: 'curated_image',
              image_urls: ['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'],
              primary_image_url: 'https://cdn.example.com/1.jpg',
            }],
          }),
          update: vi.fn((payload: unknown) => {
            updates.push(payload)
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ count: 0 }),
          insert: vi.fn((payload: unknown) => {
            inserts.push(payload)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({ count: 0 }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    const { getAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock } as never)

    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/static-news-promote-brand') as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.promoted).toBe(1)
    expect((inserts[0] as Record<string, unknown>).target_format).toBe('carousel')
    expect((inserts[0] as Record<string, unknown>).status).toBe('draft')
    expect(String((inserts[0] as Record<string, unknown>).content)).toContain('"visual_mode":"curated_image"')
    expect(String((inserts[0] as Record<string, unknown>).content)).toContain('"slides"')
    expect(updates).toContainEqual({ status: 'promoted' })
  })

  it('promove draft generated_image com json estruturado', async () => {
    const inserts: unknown[] = []
    mockGenerateTextWithFallback.mockResolvedValue(JSON.stringify({
      format: 'feed_post',
      headline: 'INFRA AGORA VIRA GARGALO',
      context: 'Mais um modelo competitivo pressiona estacionamentos, varejo e frotas a preparar recarga antes da demanda explodir.',
      kpi: 'R$ 120 mil',
      image_prompt: 'electric sedan low angle hero shot, dark premium dealership lighting, brazil launch atmosphere, no text',
      caption: 'Quando mais um elétrico competitivo entra no mercado brasileiro, a disputa sai do carro e vai para a infraestrutura. A Brand ajuda empresas a preparar recarga com visão de operação e ROI.',
    }))

    const fromMock = vi.fn((table: string) => {
      if (table === 'instagram_static_news_queue') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{
              id: 'queue-2',
              curated_content_id: 'curated-2',
              workspace_id: '00000000-0000-0000-0000-000000000000',
              source_platform: 'rss',
              source_url: 'https://site.com/noticia',
              source_author: 'portal',
              source_content: 'Geely anuncia produção local no Brasil para abastecer o mercado brasileiro em 2026',
              source_metrics: null,
              launch_category: 'production_brazil',
              launch_score: 70,
              launch_reasons: ['brazil_confirmed'],
              media_mode: 'generated_image',
              image_urls: [],
              primary_image_url: null,
            }],
          }),
          update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
        }
      }
      if (table === 'generated_content') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ count: 0 }),
          insert: vi.fn((payload: unknown) => {
            inserts.push(payload)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({ count: 0 }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      }
    })

    const { getAdminClient } = await import('@/lib/supabase/admin')
    vi.mocked(getAdminClient).mockReturnValue({ from: fromMock } as never)

    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/static-news-promote-brand') as NextRequest)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.promoted).toBe(1)
    expect((inserts[0] as Record<string, unknown>).target_format).toBe('feed_post')
    expect((inserts[0] as Record<string, unknown>).status).toBe('draft')
    expect(String((inserts[0] as Record<string, unknown>).content)).toContain('"image_prompt"')
  })
})
