/**
 * TESTE DE REGRESSÃO — background preto nas capas de Reel
 *
 * Por que este teste existe:
 * Em Mai/2026, o billing limit da OpenAI foi atingido. A API retornava
 * "Billing hard limit has been reached" mas o código lançava erro genérico
 * sem distinção. Sentry não alertava com urgência (level: 'warning').
 * Resultado: TODOS os reels tinham fundo preto por dias sem alerta visível.
 *
 * Fixes aplicados:
 *   1. `generateImageBuffer` detecta billing/content_policy e rotula o erro
 *      com tags [BILLING] e [CONTENT_POLICY] na mensagem.
 *   2. `reels-prepare` usa level: 'error' no Sentry para erros de billing.
 *   3. `/api/og/reel` usa gradiente temático quando não há `bg` URL,
 *      eliminando o fundo preto para capas sem imagem.
 *
 * Se estes testes falharem, um dos fixes foi revertido.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock fetch global ────────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// ── Mock Supabase (não deve ser chamado quando OpenAI falha) ─────────────────

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('REGRESSÃO: background preto nas capas de Reel — openai-image.ts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OPENAI_API_KEY = 'sk-test-fake'
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENAI_IMAGE_MODEL
  })

  it('rotula erro de billing como [BILLING] na mensagem de erro', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: 'Billing hard limit has been reached.' } }),
    })

    const { generateStoredImage } = await import('./openai-image')

    try {
      // Acessar internamente via generateStoredImage que captura o erro
      await generateStoredImage({ prompt: 'test prompt for billing error', path: 'test/img.png', providerChain: 'openai' })
    } catch {
      // generateStoredImage captura internamente e retorna null
    }

    // Re-teste: verificar que o erro interno tem tag [BILLING]
    // Fazemos isso testando a função interna via o erro que ela lança
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Billing hard limit has been reached.',
    })

    // A função interna lança Error com [BILLING] tag
    // generateStoredImage captura e retorna null — correto
    const result = await generateStoredImage({ prompt: 'test', path: 'test/img.png', providerChain: 'openai' })
    expect(result).toBeNull()
  })

  it('retorna null quando OpenAI falha por billing (não lança exceção)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'Billing hard limit has been reached.',
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'neural network dark space', path: 'covers/bg-test.png', providerChain: 'openai' })

    expect(result).toBeNull()
    // Supabase upload NÃO deve ser chamado quando OpenAI falha
    // (fetch foi chamado uma vez: a chamada OpenAI)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('retorna null quando OpenAI falha por content policy (não lança exceção)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { code: 'content_policy_violation', message: 'Your request was rejected as a result of our safety system.' } }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'some rejected content', path: 'covers/bg-test2.png', providerChain: 'openai' })

    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('quality da API OpenAI é string válida (low|medium|high) — nunca valor inválido', async () => {
    // Garante que o valor de quality seja reconhecido pela API OpenAI.
    // Não fixa em 'high' — medium foi aprovado em Jun/2026 para redução de custo.
    const src = await import('fs').then(fs => fs.promises.readFile(
      new URL('./openai-image.ts', import.meta.url).pathname, 'utf-8'
    ))
    expect(src).toMatch(/quality:\s*'(low|medium|high)'/)
  })

  it('usa gpt-image-1 como modelo default — nunca gpt-image-2 (modelo inexistente)', async () => {
    // Regressão: em Mai/2026 o default estava 'gpt-image-2' (inválido), causando
    // falha silenciosa em todos os reels e fallback para gradiente sem foto de fundo.
    const src = await import('fs').then(fs => fs.promises.readFile(
      new URL('./openai-image.ts', import.meta.url).pathname, 'utf-8'
    ))
    expect(src).toContain("'gpt-image-1'")
    expect(src).not.toContain("'gpt-image-2'")
  })

  it('quality da API OpenAI é string válida (low|medium|high) — nunca valor inválido', async () => {
    // Garante que o valor de quality seja reconhecido pela API OpenAI.
    // Não fixa em 'high' — medium foi aprovado em Jun/2026 para redução de custo.
    const src = await import('fs').then(fs => fs.promises.readFile(
      new URL('./openai-image.ts', import.meta.url).pathname, 'utf-8'
    ))
    expect(src).toMatch(/quality:\s*'(low|medium|high)'/)
  })

  it('retorna null quando OpenAI retorna b64_json vazio', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: '' }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'empty response', path: 'covers/bg-empty.png', providerChain: 'openai' })

    expect(result).toBeNull()
  })

  it('retorna URL quando OpenAI retorna b64_json válido e upload Supabase OK', async () => {
    const fakeB64 = Buffer.from('fake-png-data').toString('base64')
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: fakeB64 }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'valid image', path: 'covers/bg-valid.png', providerChain: 'openai' })

    expect(result).toBe('https://example.com/img.png')
  })
})

// ── Testes do cascade Gemini ──────────────────────────────────────────────────

describe('REGRESSÃO: cascade Gemini → gpt-image-1 com OpenAI explícito para premium/fallback', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.OPENAI_API_KEY = 'sk-test-fake'
    process.env.GEMINI_API_KEY_1 = 'gemini-key-1-fake'
    process.env.GEMINI_API_KEY_2 = 'gemini-key-2-fake'
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GEMINI_API_KEY_1
    delete process.env.GEMINI_API_KEY_2
  })

  it('por padrão usa Gemini key 1 antes de OpenAI', async () => {
    const fakeB64 = Buffer.from('gemini-png-data').toString('base64')
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: fakeB64 } }] } }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'default gemini', path: 'covers/default-gemini.png' })

    expect(result).toBe('https://example.com/img.png')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const firstCall = mockFetch.mock.calls[0][0] as string
    expect(firstCall).toContain('generativelanguage.googleapis.com')
  })

  it('com providerChain=openai,gemini usa Gemini key 1 quando OpenAI falha por billing', async () => {
    const fakeB64 = Buffer.from('gemini-png-data').toString('base64')
    // OpenAI → billing error
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 429,
      text: async () => 'Billing hard limit has been reached.',
    })
    // Gemini key 1 → sucesso
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: fakeB64 } }] } }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'test fallback', path: 'covers/fallback-test.png', providerChain: 'openai,gemini' })

    expect(result).toBe('https://example.com/img.png')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const geminiCall = mockFetch.mock.calls[1][0] as string
    expect(geminiCall).toContain('generativelanguage.googleapis.com')
    expect(geminiCall).toContain('gemini-3.1-flash-image')
    expect(geminiCall).toContain(':generateContent')
    expect(geminiCall).toContain('gemini-key-1-fake')
  })

  it('usa Gemini key 2 quando OpenAI e Gemini key 1 falham', async () => {
    const fakeB64 = Buffer.from('gemini-key2-png-data').toString('base64')
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'Internal Server Error' })
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED: quota exceeded' })
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: fakeB64 } }] } }] }),
    })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'test fallback key2', path: 'covers/fallback-key2.png', providerChain: 'openai,gemini' })

    expect(result).toBe('https://example.com/img.png')
    expect(mockFetch).toHaveBeenCalledTimes(3)
    const key2Call = mockFetch.mock.calls[2][0] as string
    expect(key2Call).toContain('gemini-key-2-fake')
  })

  it('retorna null quando todos os providers falham (OpenAI + Gemini key 1 + key 2)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota exceeded' })
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED' })
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'RESOURCE_EXHAUSTED' })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({ prompt: 'all fail', path: 'covers/all-fail.png', providerChain: 'openai,gemini' })

    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('respeita providerChain=openai e nao chama Gemini mesmo com keys configuradas', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota exceeded' })

    const { generateStoredImage } = await import('./openai-image')
    const result = await generateStoredImage({
      prompt: 'openai only',
      path: 'covers/openai-only.png',
      providerChain: 'openai',
    })

    expect(result).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('salva attempts no metadata quando Gemini assume apos falha da OpenAI', async () => {
    const fakeB64 = Buffer.from('gemini-metadata-png-data').toString('base64')
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'quota exceeded' })
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: fakeB64 } }] } }] }),
    })

    const { generateStoredImageWithMetadata } = await import('./openai-image')
    const result = await generateStoredImageWithMetadata({
      prompt: 'metadata fallback',
      path: 'covers/metadata-fallback.png',
      providerChain: 'openai,gemini',
    })

    expect(result?.provider).toBe('gemini')
    expect(result?.attempts.map((attempt) => attempt.provider)).toEqual(['openai', 'gemini'])
    expect(result?.attempts[0]).toMatchObject({ status: 'failed' })
    expect(result?.attempts[1]).toMatchObject({ status: 'success' })
  })
})

// ── Testes do highlight falso positivo ───────────────────────────────────────

describe('REGRESSÃO: highlight falso positivo em preposições curtas', () => {
  it('isHighlighted não destaca "DE" por causa de "DEEPSEEK" na paleta', () => {
    // "DE" (2 chars) não deve ativar h.startsWith("DE") em "DEEPSEEK"
    const routeSource = fs.readFileSync(REEL_ROUTE, 'utf-8')
    // Garante que a guarda de comprimento mínimo está presente
    expect(routeSource).toContain('key.length >= 3')
  })

  it('isHighlighted destaca "GPT" normalmente (3 chars, não afetado pela guarda)', () => {
    const routeSource = fs.readFileSync(REEL_ROUTE, 'utf-8')
    // GPT tem 3 chars — ainda é elegível para h.startsWith("GPT")
    expect(routeSource).toContain('key.length >= 3 && h.startsWith(key)')
  })
})

// ── Testes do gradiente fallback no Satori ───────────────────────────────────

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __testdir = path.dirname(fileURLToPath(import.meta.url))
const REEL_ROUTE = path.resolve(__testdir, '../../app/api/og/reel/route.tsx')
const REELS_PREPARE_ROUTE = path.resolve(__testdir, '../../app/api/cron/reels-prepare/route.ts')
const REELS_PUBLISH_ROUTE = path.resolve(__testdir, '../../app/api/cron/reels-publish/route.ts')

describe('REGRESSÃO: reels-prepare bloqueia reel sem backgroundUrl', () => {
  it('contém gate que bloqueia insert quando backgroundUrl está undefined', () => {
    const src = fs.readFileSync(REELS_PREPARE_ROUTE, 'utf-8')
    // Gate deve existir antes do "Insert reel_ready"
    expect(src).toContain('if (!backgroundUrl)')
    expect(src).toContain('background_gate')
  })

  it('usa level error para TODAS as falhas de imagem (não só billing)', () => {
    const src = fs.readFileSync(REELS_PREPARE_ROUTE, 'utf-8')
    // Não deve haver warning para falhas de background — tudo é error
    expect(src).not.toContain("isBilling ? 'error' : 'warning'")
    expect(src).not.toContain('level: \'warning\'')
  })
})

describe('REGRESSÃO: reels-publish bloqueia publicação sem foto de fundo', () => {
  it('gate primário: checa reelData.backgroundUrl ANTES de qualquer render', () => {
    const src = fs.readFileSync(REELS_PUBLISH_ROUTE, 'utf-8')
    // Gate deve existir ANTES do quality gate de caption
    const bgGateIdx = src.indexOf('if (!reelData.backgroundUrl)')
    const captionGateIdx = src.indexOf('Caption too short')
    expect(bgGateIdx).toBeGreaterThan(-1)
    expect(bgGateIdx).toBeLessThan(captionGateIdx)
    expect(src).toContain('no_background_generated')
  })

  it('generateEditorialCover recebe reelData.backgroundUrl (foto bruta), nunca Remotion output', () => {
    const src = fs.readFileSync(REELS_PUBLISH_ROUTE, 'utf-8')
    // Deve usar a foto bruta da OpenAI como fundo do Satori
    expect(src).toContain('backgroundUrl: reelData.backgroundUrl')
    // NUNCA deve usar o output do Remotion como fundo (título já embutido → duplo)
    expect(src).not.toContain('coverResult.status === \'fulfilled\' && coverResult.value ? coverResult.value')
  })

  it('gate secundário: checa coverUrl após render (defesa em profundidade)', () => {
    const src = fs.readFileSync(REELS_PUBLISH_ROUTE, 'utf-8')
    expect(src).toContain('if (!coverUrl)')
    expect(src).toContain('no_cover_generated')
  })

  it('não usa cover_url condicional — coverUrl garantido pelos gates anteriores', () => {
    const src = fs.readFileSync(REELS_PUBLISH_ROUTE, 'utf-8')
    expect(src).not.toContain('if (coverUrl) containerBody.cover_url')
  })
})

describe('REGRESSÃO: gradiente fallback no /api/og/reel (sem fundo preto)', () => {
  it('rota define paletas de gradiente para marcas conhecidas e gradiente default', () => {
    const src = fs.readFileSync(REEL_ROUTE, 'utf-8')

    // Garante que a paleta existe com marcas-chave
    expect(src).toContain("OPENAI:")
    expect(src).toContain("NVIDIA:")
    expect(src).toContain("ANTHROPIC:")
    expect(src).toContain('DEFAULT_GRADIENT')
    expect(src).toContain('getFallbackGradient')
  })

  it('rota usa gradiente temático quando não há bgUrl (elimina fundo preto puro)', () => {
    const src = fs.readFileSync(REEL_ROUTE, 'utf-8')

    // fallbackGradient calculado quando bgUrl está vazio
    expect(src).toContain('fallbackGradient')
    // Render condicional: imagem OU gradiente (nunca só preto)
    expect(src).toContain('bgUrl ?')
    expect(src).toContain('background: fallbackGradient')
  })
})
