import { afterEach, describe, expect, it, vi } from 'vitest'
import { reviewInstagramVisualQuality } from './instagram-visual-quality'

// REGRESSÃO: gemini-3-flash-preview é um modelo de raciocínio — ele gasta parte do
// maxOutputTokens em "thinking" interno (thoughtsTokenCount) ANTES de escrever a
// resposta. Reproduzido em produção em 2026-07-18: com maxOutputTokens=900 e sem
// thinkingConfig, o modelo consumiu 862 tokens pensando e sobraram 23 tokens pra
// resposta, cortando o JSON no meio ("finishReason": "MAX_TOKENS") e derrubando o
// gate 3 dias seguidos (1 item @brand morto por dia: 685b401c 16/07, 161339f7
// 17/07, a4cbf248 18/07). Reproduzido via chamada real à API do Gemini com o prompt
// exato deste arquivo — thinkingConfig: { thinkingBudget: 0 } eliminou o consumo de
// thinking tokens e o mesmo payload voltou com "finishReason": "STOP" e JSON válido.
describe('REGRESSÃO: truncamento por thinking tokens (gemini-3-flash-preview)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.GEMINI_API_KEY
  })

  it('desliga o thinking budget na chamada ao Gemini — sem isso o modelo gasta o budget pensando e trunca o JSON', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    let capturedBody: any = null
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://example.com/post.png') {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
      }
      capturedBody = JSON.parse(init!.body as string)
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        scores: { visual_quality: 8, legibility: 8, text_visual_correlation: 8, sequence_coherence: null, context: 8, promise_delivery: null },
        blocking_issues: [],
        improvements: [],
        feedback: 'Aprovado.',
      }) }] }, finishReason: 'STOP' }] })
    }))

    await reviewInstagramVisualQuality({
      caption: 'Legenda de teste',
      format: 'image',
      assets: [{ type: 'image', url: 'https://example.com/post.png' }],
    })

    expect(capturedBody.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 })
  })

  it('fails closed (not a crash) if the model still truncates mid-JSON despite thinkingBudget:0', async () => {
    process.env.GEMINI_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://example.com/post.png') {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
      }
      // Real truncated payload captured from production reproduction (finishReason: MAX_TOKENS)
      return Response.json({
        candidates: [{ content: { parts: [{ text: '{\n  "scores": {\n    "visual_quality": 0,\n    "legibility":' }] }, finishReason: 'MAX_TOKENS' }],
        usageMetadata: { promptTokenCount: 1687, candidatesTokenCount: 23, totalTokenCount: 2572, thoughtsTokenCount: 862 },
      })
    }))

    const result = await reviewInstagramVisualQuality({
      caption: 'Legenda de teste',
      format: 'image',
      assets: [{ type: 'image', url: 'https://example.com/post.png' }],
    })

    expect(result.outcome).toBe('unavailable')
    expect(result.passed).toBe(false)
    expect(result.issues[0]).toContain('Could not parse JSON from AI response')
  })
})
