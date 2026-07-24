/**
 * TESTE DE REGRESSÃO — gpt-image-2 Brand → Gemini primário
 *
 * Por que este teste existe:
 * Em Jun/2026, o relatório OpenAI revelou $74.79 em 15 dias no modelo gpt-image-2.
 * Os 3 arquivos Brand usavam gpt-image-2 como primário e Gemini como fallback —
 * mas desde abril/2026 o gpt-image-2 passou a existir na API, então a chamada
 * começou a suceder e cobrar ~$0.167/imagem (high quality) em vez do Gemini ($0.004).
 *
 * Fixes aplicados:
 *   1. `generate-brand-reel-cover.ts` — Gemini primary, gpt-image-1 medium fallback
 *   2. `generate-brand-post-image.ts` — idem
 *   3. `generate-brand-carousel.ts`   — idem (N slides em paralelo)
 *
 * Se estes testes falharem, um dos fixes foi revertido.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __testdir = path.dirname(fileURLToPath(import.meta.url))

const REEL_COVER  = path.resolve(__testdir, './generate-brand-reel-cover.ts')
const POST_IMAGE  = path.resolve(__testdir, './generate-brand-post-image.ts')
const CAROUSEL    = path.resolve(__testdir, './generate-brand-carousel.ts')

// ── Mock fetch global ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Mock Supabase ─────────────────────────────────────────────────────────────

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
vi.mock('./brand-logos', () => ({
  detectBrand: () => null,
  resolveLogoUrl: () => null,
}))

// ── Source-level guards (não requerem fetch) ──────────────────────────────────

describe('REGRESSÃO: gpt-image-2 removido dos arquivos Brand', () => {
  it('generate-brand-reel-cover.ts não contém gpt-image-2', () => {
    const src = fs.readFileSync(REEL_COVER, 'utf-8')
    expect(src).not.toContain("'gpt-image-2'")
    expect(src).not.toContain('"gpt-image-2"')
  })

  it('generate-brand-post-image.ts não contém gpt-image-2', () => {
    const src = fs.readFileSync(POST_IMAGE, 'utf-8')
    expect(src).not.toContain("'gpt-image-2'")
    expect(src).not.toContain('"gpt-image-2"')
  })

  it('generate-brand-carousel.ts não contém gpt-image-2', () => {
    const src = fs.readFileSync(CAROUSEL, 'utf-8')
    expect(src).not.toContain("'gpt-image-2'")
    expect(src).not.toContain('"gpt-image-2"')
  })

  it('generate-brand-reel-cover.ts usa Gemini como primary (gemini-3.1-flash-image)', () => {
    const src = fs.readFileSync(REEL_COVER, 'utf-8')
    // Gemini deve aparecer ANTES do gpt-image-1 no arquivo
    const geminiIdx = src.indexOf('gemini-3.1-flash-image')
    const gptIdx    = src.indexOf("'gpt-image-1'")
    expect(geminiIdx).toBeGreaterThan(-1)
    expect(gptIdx).toBeGreaterThan(-1)
    expect(geminiIdx).toBeLessThan(gptIdx)
  })

  it('generate-brand-carousel.ts usa Gemini como primary (gemini-3.1-flash-image)', () => {
    const src = fs.readFileSync(CAROUSEL, 'utf-8')
    const geminiIdx = src.indexOf('gemini-3.1-flash-image')
    const gptIdx    = src.indexOf("'gpt-image-1'")
    expect(geminiIdx).toBeGreaterThan(-1)
    expect(gptIdx).toBeGreaterThan(-1)
    expect(geminiIdx).toBeLessThan(gptIdx)
  })

  // REGRESSÃO: capas de Reel e slides de carrossel do brand são 9:16 — sem
  // imageConfig.aspectRatio o gemini-3.1-flash-image gera ~1:1 e o Satori recorta,
  // degradando a capa de Reel. Posts estáticos únicos (post-image) são 3:4
  // (decisão de produto 2026-07-07: a grade do IG é 3:4; o 1:1 anterior saía
  // cortado nas laterais — ver brand-grid-3x4.regression.test.ts).
  it.each([
    ['reel-cover', '9:16', REEL_COVER],
    ['carousel', '9:16', CAROUSEL],
    ['post-image', '3:4', POST_IMAGE],
  ])('%s pede aspectRatio %s via imageConfig', (_name, expectedRatio, file) => {
    const src = fs.readFileSync(file, 'utf-8')
    expect(src).toContain('imageConfig')
    expect(src).toMatch(new RegExp(`aspectRatio:\\s*['"]${expectedRatio}['"]`))
  })
})

// ── Testes de comportamento em runtime ───────────────────────────────────────

describe('REGRESSÃO: Gemini é chamado primeiro no generatebrandReelCover', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OPENAI_API_KEY    = 'sk-test-fake'
    process.env.GEMINI_API_KEY_2  = 'gemini-key-fake'
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY_2
  })

  it('chama Gemini (generativelanguage.googleapis.com) antes de qualquer chamada OpenAI', async () => {
    const fakeB64 = Buffer.from('gemini-bg').toString('base64')

    // Gemini → sucesso
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: fakeB64 } }] } }] }),
    })
    // Satori overlay
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      arrayBuffer: async () => Buffer.from('fake-png').buffer,
    })

    const { generatebrandReelCover } = await import('./generate-brand-reel-cover')
    await generatebrandReelCover({
      hookTitle: 'Test Title',
      highlightName: 'Tesla',
      imagePrompt: 'EV charging station',
      itemId: 'test-123',
    })

    // Primeira chamada fetch deve ser ao Gemini, não à OpenAI
    const firstCall = mockFetch.mock.calls[0][0] as string
    expect(firstCall).toContain('generativelanguage.googleapis.com')
    expect(firstCall).toContain('gemini-3.1-flash-image')
    expect(firstCall).toContain(':generateContent')
    expect(firstCall).not.toContain('openai.com')
  })

  it('usa gpt-image-1 (não gpt-image-2) quando Gemini falha', async () => {
    const fakeB64 = Buffer.from('openai-bg').toString('base64')

    // Gemini → falha
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED' })
    // gpt-image-1 → sucesso
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ data: [{ b64_json: fakeB64 }] }),
    })
    // Satori overlay
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      arrayBuffer: async () => Buffer.from('fake-png').buffer,
    })

    const { generatebrandReelCover } = await import('./generate-brand-reel-cover')
    await generatebrandReelCover({
      hookTitle: 'Test Title',
      highlightName: 'Tesla',
      imagePrompt: 'EV charging station',
      itemId: 'test-456',
    })

    const openaiCall = mockFetch.mock.calls[1][0] as string
    expect(openaiCall).toContain('openai.com')

    // Verifica que o body usa gpt-image-1, nunca gpt-image-2
    const openaiBody = JSON.parse(mockFetch.mock.calls[1][1].body as string)
    expect(openaiBody.model).toBe('gpt-image-1')
    expect(openaiBody.model).not.toBe('gpt-image-2')
    expect(openaiBody.quality).toBe('medium')
  })
})
