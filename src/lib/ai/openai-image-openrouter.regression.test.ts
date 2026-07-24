/**
 * REGRESSÃO: OpenRouter como tier-0 em generateWithFallback (openai-image.ts)
 *
 * A cascata Gemini→gpt-image-1 protegida por Cláusula Pétrea permanece
 * intocada — estes testes provam que a nova tentativa OpenRouter só se
 * intromete quando OPENROUTER_API_KEY está setada, e cai pra cascata
 * existente em qualquer falha.
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

describe('REGRESSÃO: openai-image.ts — tier-0 OpenRouter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.GEMINI_API_KEY_1 = 'gemini-key-1-fake'
  })

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
    delete process.env.GEMINI_API_KEY_1
  })

  it('sem OPENROUTER_API_KEY, primeira chamada vai direto pra cascata Gemini existente', async () => {
    delete process.env.OPENROUTER_API_KEY
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'sem chave openrouter', path: 'covers/no-or.png' })

    expect(result).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain('generativelanguage.googleapis.com')
  })

  it('com a chave setada, sucesso no OpenRouter nunca chama a cascata Gemini/OpenAI', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'AAAA' }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'com openrouter', path: 'covers/or-ok.png' })

    expect(result).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/images')
  })

  it('com a chave setada, falha no OpenRouter cai pra cascata Gemini existente, intocada', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'openrouter down' })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] }),
      })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'openrouter cai', path: 'covers/or-fallback.png' })

    expect(result).not.toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/images')
    expect(mockFetch.mock.calls[1][0]).toContain('generativelanguage.googleapis.com')
  })
})
