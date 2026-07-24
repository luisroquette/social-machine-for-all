/**
 * REGRESSÃO: generateTextWithFallback — AI resilience system
 *
 * Bug (mai/2026): reels-prepare usava fetch direto para a API Anthropic sem
 * retry, fallback ou sentinel. Um único 429 ou 5xx derrubava todo o pipeline
 * silenciosamente — nenhum item era preparado, nenhum alerta era disparado.
 *
 * Fix:
 * - generateTextWithFallback: primary com retry exponencial, fallback pro secundário
 * - isTransientAiError: identifica 429, 5xx, timeout, ECONNRESET como transientes
 * - aiSentinelCode: mapeia erros para skip_reason em curated_content
 * - cleanup-storage: reseta sentineis expirados (ai_rate_limited=4h, ai_unavailable=2h)
 *
 * ATUALIZADO (2026-07-22, manhã): primary migrou de Claude pra DeepSeek (deepseek-v4-flash).
 *
 * ATUALIZADO (2026-07-22, tarde): descoberto que GOOGLE_GENERATIVE_AI_API_KEY estava
 * vazia em produção (bug do `vercel env add` sem `--value`) — o fallback Gemini direto
 * (`@ai-sdk/google`) nunca funcionou de verdade. Gemini agora vai SEMPRE via OpenRouter
 * (que já tem OPENROUTER_API_KEY válida e não sofre do problema de roteamento que o
 * DeepSeek tem). `@ai-sdk/google` foi removido deste arquivo.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isTransientAiError, aiSentinelCode, AI_SENTINEL, generateTextWithFallback } from './generate-with-fallback'

// ── isTransientAiError ────────────────────────────────────────────────────────

describe('REGRESSÃO: isTransientAiError — detecção correta de erros transientes', () => {
  it('429 é transiente', () => {
    const err = Object.assign(new Error('Rate limited'), { statusCode: 429 })
    expect(isTransientAiError(err)).toBe(true)
  })

  it('503 é transiente', () => {
    const err = Object.assign(new Error('Service unavailable'), { statusCode: 503 })
    expect(isTransientAiError(err)).toBe(true)
  })

  it('529 (Anthropic overloaded) é transiente', () => {
    const err = Object.assign(new Error('Overloaded'), { statusCode: 529 })
    expect(isTransientAiError(err)).toBe(true)
  })

  it('TimeoutError é transiente', () => {
    const err = Object.assign(new Error('Timeout'), { name: 'TimeoutError' })
    expect(isTransientAiError(err)).toBe(true)
  })

  it('ECONNRESET é transiente', () => {
    const err = Object.assign(new Error('Connection reset'), { code: 'ECONNRESET' })
    expect(isTransientAiError(err)).toBe(true)
  })

  it('isRetryable=true é transiente', () => {
    const err = Object.assign(new Error('Retryable'), { isRetryable: true })
    expect(isTransientAiError(err)).toBe(true)
  })

  it('400 (bad request) NÃO é transiente', () => {
    const err = Object.assign(new Error('Bad request'), { statusCode: 400 })
    expect(isTransientAiError(err)).toBe(false)
  })

  it('401 (auth error) NÃO é transiente', () => {
    const err = Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    expect(isTransientAiError(err)).toBe(false)
  })

  it('non-Error value NÃO é transiente', () => {
    expect(isTransientAiError('string error')).toBe(false)
    expect(isTransientAiError(null)).toBe(false)
    expect(isTransientAiError(undefined)).toBe(false)
  })
})

// ── aiSentinelCode ────────────────────────────────────────────────────────────

describe('REGRESSÃO: aiSentinelCode — mapeamento para skip_reason correto', () => {
  it('429 → ai_rate_limited', () => {
    const err = Object.assign(new Error('Rate limited'), { statusCode: 429 })
    expect(aiSentinelCode(err)).toBe(AI_SENTINEL.RATE_LIMITED)
  })

  it('503 → ai_unavailable', () => {
    const err = Object.assign(new Error('Service unavailable'), { statusCode: 503 })
    expect(aiSentinelCode(err)).toBe(AI_SENTINEL.UNAVAILABLE)
  })

  it('529 (Anthropic overloaded) → ai_unavailable', () => {
    const err = Object.assign(new Error('Overloaded'), { statusCode: 529 })
    expect(aiSentinelCode(err)).toBe(AI_SENTINEL.UNAVAILABLE)
  })

  it('TimeoutError → ai_unavailable', () => {
    const err = Object.assign(new Error('Timeout'), { name: 'TimeoutError' })
    expect(aiSentinelCode(err)).toBe(AI_SENTINEL.UNAVAILABLE)
  })

  it('400 (permanent error) → ai_error (não sentinel, vai para Sentry)', () => {
    const err = Object.assign(new Error('Bad request'), { statusCode: 400 })
    expect(aiSentinelCode(err)).toBe('ai_error')
  })

  it('erro genérico sem statusCode → ai_error', () => {
    const err = new Error('Unknown error')
    expect(aiSentinelCode(err)).toBe('ai_error')
  })
})

// ── AI_SENTINEL constants ─────────────────────────────────────────────────────

describe('REGRESSÃO: AI_SENTINEL — constantes imutáveis (cleanup-storage depende delas)', () => {
  it('RATE_LIMITED = "ai_rate_limited"', () => {
    expect(AI_SENTINEL.RATE_LIMITED).toBe('ai_rate_limited')
  })

  it('UNAVAILABLE = "ai_unavailable"', () => {
    expect(AI_SENTINEL.UNAVAILABLE).toBe('ai_unavailable')
  })
})

// ── generateTextWithFallback — DeepSeek direto, Gemini sempre via OpenRouter ──
//
// ATUALIZADO (2026-07-22): DeepSeek NUNCA passa por OpenRouter (achado 19-21/07 —
// roteamento não-confiável, mesmo slug respondeu como GPT-4/Claude dependendo do
// backend terceiro). Gemini SEMPRE via OpenRouter, nunca @ai-sdk/google direto
// (GOOGLE_GENERATIVE_AI_API_KEY estava vazia em produção — ver descoberta da tarde
// de 22/07 no topo do arquivo). A resiliência em si (retry exponencial, fallback
// automático, sentinel pattern — Cláusula Pétrea #9/#10) não foi alterada.

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))
vi.mock('@ai-sdk/deepseek', () => ({ deepseek: vi.fn((id: string) => ({ __tag: 'direct-deepseek', id })) }))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => (id: string) => ({ __tag: 'openrouter', id })),
}))

const mockGenerateText = vi.fn()

describe('REGRESSÃO: generateTextWithFallback — DeepSeek direto (primary), Gemini via OpenRouter (fallback)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
  })

  it('sem OPENROUTER_API_KEY, DeepSeek sozinho já resolve — não precisa de fallback', async () => {
    delete process.env.OPENROUTER_API_KEY
    mockGenerateText.mockResolvedValueOnce({ text: 'resposta do deepseek' })

    const text = await generateTextWithFallback({ system: 'sys', prompt: 'prompt' })

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-deepseek')
    expect(mockGenerateText.mock.calls[0][0].providerOptions).toEqual({ deepseek: { thinking: { type: 'disabled' } } })
    expect(text).toBe('resposta do deepseek')
  })

  it('com OPENROUTER_API_KEY setada, DeepSeek (default) NUNCA passa por OpenRouter', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockGenerateText.mockResolvedValueOnce({ text: '  resposta do deepseek  ' })

    const text = await generateTextWithFallback({ system: 'sys', prompt: 'prompt' })

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-deepseek')
    expect(text).toBe('resposta do deepseek')
  })

  it('DeepSeek falha (não-transiente) + OPENROUTER_API_KEY ausente → fallback Gemini rejeita sem tentar rede, erro sobe', async () => {
    delete process.env.OPENROUTER_API_KEY
    mockGenerateText.mockRejectedValueOnce(Object.assign(new Error('deepseek down'), { statusCode: 400 }))

    await expect(generateTextWithFallback({ system: 'sys', prompt: 'prompt' })).rejects.toThrow(
      'OPENROUTER_API_KEY not configured',
    )
    // Só a tentativa do DeepSeek — o fallback nem chega a chamar generateText
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
  })

  it('DeepSeek falha (não-transiente) + OPENROUTER_API_KEY presente → fallback Gemini via OpenRouter resolve', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockGenerateText
      .mockRejectedValueOnce(Object.assign(new Error('deepseek down'), { statusCode: 400 }))
      .mockResolvedValueOnce({ text: 'resposta do gemini via openrouter' })

    const text = await generateTextWithFallback({ system: 'sys', prompt: 'prompt' })

    expect(mockGenerateText).toHaveBeenCalledTimes(2)
    expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-deepseek')
    expect(mockGenerateText.mock.calls[1][0].model.__tag).toBe('openrouter')
    expect(mockGenerateText.mock.calls[1][0].model.id).toBe('google/gemini-2.5-flash')
    expect(text).toBe('resposta do gemini via openrouter')
  })

  it('com primary="gemini" e chave setada, usa Gemini via OpenRouter direto (sem tocar DeepSeek)', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockGenerateText.mockResolvedValueOnce({ text: 'ok' })

    await generateTextWithFallback({ system: 'sys', prompt: 'prompt', primary: 'gemini' })

    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('openrouter')
    expect(mockGenerateText.mock.calls[0][0].model.id).toBe('google/gemini-2.5-flash')
  })

  it('com primary="gemini", falha no OpenRouter cai pro DeepSeek direto', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockGenerateText
      .mockRejectedValueOnce(Object.assign(new Error('openrouter down'), { statusCode: 400 }))
      .mockResolvedValueOnce({ text: 'resposta do deepseek fallback' })

    const text = await generateTextWithFallback({ system: 'sys', prompt: 'prompt', primary: 'gemini' })

    expect(mockGenerateText).toHaveBeenCalledTimes(2)
    expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('openrouter')
    expect(mockGenerateText.mock.calls[1][0].model.__tag).toBe('direct-deepseek')
    expect(text).toBe('resposta do deepseek fallback')
  })

  it('com primary="gemini" e SEM OPENROUTER_API_KEY, rejeita sem tentar rede e cai direto pro DeepSeek', async () => {
    delete process.env.OPENROUTER_API_KEY
    mockGenerateText.mockResolvedValueOnce({ text: 'resposta do deepseek' })

    const text = await generateTextWithFallback({ system: 'sys', prompt: 'prompt', primary: 'gemini' })

    // Só 1 chamada de rede — a tentativa "gemini" nem chega a chamar generateText
    expect(mockGenerateText).toHaveBeenCalledTimes(1)
    expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-deepseek')
    expect(text).toBe('resposta do deepseek')
  })
})
