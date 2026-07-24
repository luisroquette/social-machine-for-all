/**
 * REGRESSÃO: OpenRouter como tier-0 nos 3 geradores de imagem Brand
 * (generate-brand-post-image.ts, generate-brand-carousel.ts,
 * generate-brand-reel-cover.ts). A cascata Gemini→gpt-image-1 protegida
 * (ver generate-brand-image.regression.test.ts) permanece intocada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    storage: {
      from: () => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/img.png' } }),
      }),
    },
  }),
}))
vi.mock('@/lib/api/base-url', () => ({ getBaseUrl: () => 'http://localhost:3000' }))
vi.mock('./brand-logos', () => ({ detectBrand: () => null, resolveLogoUrl: () => null }))

const satoriResponse = { ok: true, status: 200, arrayBuffer: async () => Buffer.from('fake-png').buffer }
const openRouterSuccess = { ok: true, status: 200, json: async () => ({ data: [{ b64_json: Buffer.from('or-bg').toString('base64') }] }) }

describe('REGRESSÃO: generate-brand-post-image.ts — tier-0 OpenRouter', () => {
  beforeEach(() => { vi.resetAllMocks() })
  afterEach(() => { delete process.env.OPENROUTER_API_KEY })

  it('com a chave setada, sucesso no OpenRouter nunca chama Gemini/OpenAI', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockFetch.mockResolvedValueOnce(openRouterSuccess).mockResolvedValueOnce(satoriResponse)

    const { generatebrandPostImage } = await import('./generate-brand-post-image')
    const result = await generatebrandPostImage({ headline: 'H', context: 'C', imagePrompt: 'p', itemId: 'test-1' })

    expect(result).not.toBeNull()
    expect(mockFetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/images')
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('generativelanguage')) ).toBe(false)
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('openai.com'))).toBe(false)
  })
})

describe('REGRESSÃO: generate-brand-carousel.ts — tier-0 OpenRouter', () => {
  beforeEach(() => { vi.resetAllMocks() })
  afterEach(() => { delete process.env.OPENROUTER_API_KEY })

  it('com a chave setada, sucesso no OpenRouter por slide nunca chama Gemini/OpenAI', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockFetch
      .mockResolvedValueOnce(openRouterSuccess).mockResolvedValueOnce(openRouterSuccess)
      .mockResolvedValueOnce(satoriResponse).mockResolvedValueOnce(satoriResponse)

    const { generatebrandCarousel } = await import('./generate-brand-carousel')
    const result = await generatebrandCarousel({
      imagePrompt: 'p',
      itemId: 'test-2',
      slides: [
        { type: 'cover', headline: 'H1' },
        { type: 'cta', headline: 'H2' },
      ],
    })

    expect(result).not.toBeNull()
    expect(result?.length).toBe(2)
    expect(mockFetch.mock.calls.filter((c) => c[0] === 'https://openrouter.ai/api/v1/images')).toHaveLength(2)
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('generativelanguage'))).toBe(false)
  })
})

describe('REGRESSÃO: generate-brand-reel-cover.ts — tier-0 OpenRouter com timeout reduzido', () => {
  beforeEach(() => { vi.resetAllMocks() })
  afterEach(() => { delete process.env.OPENROUTER_API_KEY })

  it('com a chave setada, sucesso no OpenRouter nunca chama Gemini/OpenAI', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockFetch.mockResolvedValueOnce(openRouterSuccess).mockResolvedValueOnce(satoriResponse)

    const { generatebrandReelCover } = await import('./generate-brand-reel-cover')
    const result = await generatebrandReelCover({ hookTitle: 'H', highlightName: 'X', imagePrompt: 'p', itemId: 'test-3' })

    expect(result).not.toBeNull()
    expect(mockFetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/images')
    expect(mockFetch.mock.calls.some((c) => String(c[0]).includes('generativelanguage'))).toBe(false)
  })

  it('sem OPENROUTER_API_KEY, comportamento é idêntico ao atual (Gemini chamado primeiro)', async () => {
    delete process.env.OPENROUTER_API_KEY
    process.env.GEMINI_API_KEY_2 = 'gemini-key-fake'
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('g').toString('base64') } }] } }] }) })
      .mockResolvedValueOnce(satoriResponse)

    const { generatebrandReelCover } = await import('./generate-brand-reel-cover')
    await generatebrandReelCover({ hookTitle: 'H', highlightName: 'X', imagePrompt: 'p', itemId: 'test-4' })

    expect(mockFetch.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
    delete process.env.GEMINI_API_KEY_2
  })
})
