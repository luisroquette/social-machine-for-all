/**
 * REGRESSÃO: burnSubtitlesForX (tradução de SRT pra PT-BR) fazia fetch direto
 * à API da Anthropic — violação da Cláusula Pétrea #9 do CLAUDE.md ("NUNCA
 * fazer fetch direto à API Anthropic nos crons. Usar SEMPRE
 * generateTextWithFallback()"). Corrigido 2026-07-19, envolvido no mesmo
 * orçamento de 20s (promiseWithTimeout) que a chamada original já respeitava,
 * pra não estourar o budget combinado de 265s (45s transcribe + 20s translate
 * + 200s render) do pipeline de repost em vídeo pro X/Twitter.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockGenerateTextWithFallback = vi.fn()
vi.mock('@/lib/ai/generate-with-fallback', () => ({
  generateTextWithFallback: (...args: unknown[]) => mockGenerateTextWithFallback(...args),
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { burnSubtitlesForX } from './index'

const SRC = readFileSync(join(process.cwd(), 'src/lib/agents/publisher/index.ts'), 'utf8')

describe('REGRESSÃO: burnSubtitlesForX usa generateTextWithFallback, não fetch direto à Anthropic', () => {
  it('o código-fonte não contém mais fetch direto a api.anthropic.com', () => {
    expect(SRC).not.toContain('api.anthropic.com')
    expect(SRC).not.toContain("'x-api-key'")
  })

  it('o código-fonte usa generateTextWithFallback envolto em promiseWithTimeout (20s)', () => {
    const start = SRC.indexOf('Step 2: Translate SRT')
    const nextStep = SRC.indexOf('Step 3:', start)
    const block = SRC.slice(start, nextStep)
    expect(block).toContain('generateTextWithFallback(')
    expect(block).toContain('promiseWithTimeout(')
    expect(block).toMatch(/20_000/)
  })
})

const REEL_RENDERER_ENV = { REEL_RENDERER_URL: 'https://renderer.example.com', REEL_RENDERER_API_KEY: 'test-key' }

function mockTranscribeSuccess(srt: string) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'hello world this is speech', srt }) })
}
function mockRenderSuccess() {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ videoUrl: 'https://renderer.example.com/final.mp4' }) })
}

const SAMPLE_SRT = '1\n00:00:00,000 --> 00:00:02,000\nHello world\n'

describe('REGRESSÃO: comportamento de burnSubtitlesForX preservado após a troca', () => {
  afterEach(() => {
    vi.resetAllMocks()
    delete process.env.REEL_RENDERER_URL
    delete process.env.REEL_RENDERER_API_KEY
  })

  it('usa a tradução quando generateTextWithFallback tem sucesso', async () => {
    Object.assign(process.env, REEL_RENDERER_ENV)
    mockTranscribeSuccess(SAMPLE_SRT)
    mockGenerateTextWithFallback.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nOlá mundo\n')
    mockRenderSuccess()

    const result = await burnSubtitlesForX('https://video.example.com/v.mp4')

    expect(result).toBe('https://renderer.example.com/final.mp4')
    expect(mockGenerateTextWithFallback).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: SAMPLE_SRT, maxOutputTokens: 2000 }),
    )
    // O render final recebeu os subtítulos traduzidos, não o original
    const renderCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(renderCallBody.subtitles[0].text).toBe('Olá mundo')
  })

  it('cai pro SRT original (não-fatal) quando generateTextWithFallback falha', async () => {
    Object.assign(process.env, REEL_RENDERER_ENV)
    mockTranscribeSuccess(SAMPLE_SRT)
    mockGenerateTextWithFallback.mockRejectedValueOnce(new Error('all providers failed'))
    mockRenderSuccess()

    const result = await burnSubtitlesForX('https://video.example.com/v.mp4')

    expect(result).toBe('https://renderer.example.com/final.mp4')
    const renderCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(renderCallBody.subtitles[0].text).toBe('Hello world')
  })

  it('cai pro SRT original quando generateTextWithFallback estoura os 20s (promiseWithTimeout)', async () => {
    Object.assign(process.env, REEL_RENDERER_ENV)
    mockTranscribeSuccess(SAMPLE_SRT)
    // Nunca resolve — simula uma chamada travada; promiseWithTimeout deve vencer a corrida.
    mockGenerateTextWithFallback.mockImplementationOnce(() => new Promise(() => {}))
    mockRenderSuccess()

    const result = await burnSubtitlesForX('https://video.example.com/v.mp4')

    expect(result).toBe('https://renderer.example.com/final.mp4')
    const renderCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(renderCallBody.subtitles[0].text).toBe('Hello world')
  }, 25_000)
})
