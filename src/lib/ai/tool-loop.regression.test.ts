import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGenerateText = vi.fn()
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateText: (...args: unknown[]) => mockGenerateText(...args),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: vi.fn((id: string) => ({ __tag: 'direct-anthropic', id })),
}))
vi.mock('@ai-sdk/deepseek', () => ({
  deepseek: vi.fn((id: string) => ({ __tag: 'direct-deepseek', id })),
}))
vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: vi.fn(() => (id: string) => ({ __tag: 'openrouter', id })),
}))

import { executeToolLoop, generateSimpleText } from './tool-loop'

const baseResult = {
  text: 'ok',
  usage: { totalTokens: 42 },
  steps: [{ toolCalls: [], toolResults: [] }],
}

// REGRESSÃO: garante que os 15+ agentes que chamam executeToolLoop/generateSimpleText
// (writer, reviewer, monitor, ads-strategist, engagement-own/external,
// social-strategist, seo-strategist, editor-in-chief, etc.) ganham a tentativa
// OpenRouter automaticamente, sem precisar mudar nenhum desses arquivos, e sem
// alterar o comportamento existente quando OPENROUTER_API_KEY não está setada.
describe('REGRESSÃO: tool-loop — OpenRouter como tier-0, fallback direto preservado', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
  })

  describe('generateSimpleText', () => {
    it('sem OPENROUTER_API_KEY, comportamento é idêntico ao atual (só o provider direto é chamado)', async () => {
      delete process.env.OPENROUTER_API_KEY
      mockGenerateText.mockResolvedValueOnce(baseResult)

      const result = await generateSimpleText({ model: 'claude-haiku', systemPrompt: 'sys', userMessage: 'hi' })

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-anthropic')
      expect(mockGenerateText.mock.calls[0][0].providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
        deepseek: { thinking: { type: 'disabled' } },
      })
      expect(result.text).toBe('ok')
    })

    it('com a chave setada, sucesso no OpenRouter nunca invoca o provider direto', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      mockGenerateText.mockResolvedValueOnce(baseResult)

      await generateSimpleText({ model: 'claude-haiku', systemPrompt: 'sys', userMessage: 'hi' })

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('openrouter')
      // Custo, não correção: cacheControl omitido no tier OpenRouter (passthrough não confirmado)
      expect(mockGenerateText.mock.calls[0][0].providerOptions).toBeUndefined()
    })

    it('com a chave setada, falha no OpenRouter cai pro provider direto com resultado idêntico ao atual', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      mockGenerateText
        .mockRejectedValueOnce(new Error('openrouter down'))
        .mockResolvedValueOnce(baseResult)

      const result = await generateSimpleText({ model: 'claude-haiku', systemPrompt: 'sys', userMessage: 'hi' })

      expect(mockGenerateText).toHaveBeenCalledTimes(2)
      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('openrouter')
      expect(mockGenerateText.mock.calls[1][0].model.__tag).toBe('direct-anthropic')
      expect(mockGenerateText.mock.calls[1][0].providerOptions).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
        deepseek: { thinking: { type: 'disabled' } },
      })
      expect(result.text).toBe('ok')
      expect(result.tokensUsed).toBe(42)
    })
  })

  describe('executeToolLoop', () => {
    it('sem OPENROUTER_API_KEY, comportamento é idêntico ao atual', async () => {
      delete process.env.OPENROUTER_API_KEY
      mockGenerateText.mockResolvedValueOnce(baseResult)

      await executeToolLoop({ model: 'claude-sonnet', systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-anthropic')
    })

    it('sucesso no OpenRouter nunca invoca o provider direto', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      mockGenerateText.mockResolvedValueOnce(baseResult)

      await executeToolLoop({ model: 'claude-sonnet', systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })

      expect(mockGenerateText).toHaveBeenCalledTimes(1)
      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('openrouter')
    })

    it('falha no OpenRouter reinicia o loop inteiro no provider direto — nunca retoma parcialmente', async () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-test'
      const multiStepDirectResult = {
        text: 'final answer',
        usage: { totalTokens: 100 },
        steps: [
          { toolCalls: [{ toolCallId: '1', toolName: 'search', args: {} }], toolResults: [{ toolCallId: '1', result: 'r1' }] },
          { toolCalls: [], toolResults: [] },
        ],
      }
      mockGenerateText
        .mockRejectedValueOnce(new Error('openrouter down mid-loop'))
        .mockResolvedValueOnce(multiStepDirectResult)

      const result = await executeToolLoop({ model: 'claude-sonnet', systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })

      expect(mockGenerateText).toHaveBeenCalledTimes(2)
      // A segunda chamada (direta) recebe os MESMOS messages/tools da primeira — prova
      // que é um reinício completo e independente com o input original intacto,
      // não uma tentativa de retomar a partir de estado parcial do OpenRouter.
      expect(mockGenerateText.mock.calls[1][0].messages).toEqual(mockGenerateText.mock.calls[0][0].messages)
      expect(mockGenerateText.mock.calls[1][0].stopWhen).toBeTypeOf('function')
      // O resultado final reflete inteiramente a chamada direta (2 steps), sem mistura com a tentativa falha do OpenRouter.
      expect(result.stepsCompleted).toBe(2)
      expect(result.toolCalls).toEqual([{ name: 'search', args: {}, result: 'r1' }])
      expect(result.text).toBe('final answer')
    })
  })

  // REGRESSÃO 2026-07-21: 'deepseek-v4-flash' (o que 'deepseek-chat' virou após a
  // migração de 24/07) entra em modo "thinking" por padrão se esse parâmetro não
  // for passado — verificado ao vivo, gastou o orçamento inteiro de tokens
  // "pensando" e devolveu resposta vazia. deepseek-chat nunca vai pro tier
  // OpenRouter (ver provider.test.ts), então sempre passa por aqui.
  describe('deepseek: thinking sempre desabilitado explicitamente (senão entra em modo reasoning)', () => {
    it('generateSimpleText com model=deepseek-chat manda providerOptions.deepseek.thinking.disabled', async () => {
      delete process.env.OPENROUTER_API_KEY
      mockGenerateText.mockResolvedValueOnce(baseResult)

      await generateSimpleText({ model: 'deepseek-chat', systemPrompt: 'sys', userMessage: 'hi' })

      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-deepseek')
      expect(mockGenerateText.mock.calls[0][0].providerOptions.deepseek).toEqual({ thinking: { type: 'disabled' } })
    })

    it('executeToolLoop com model=deepseek-chat manda providerOptions.deepseek.thinking.disabled', async () => {
      delete process.env.OPENROUTER_API_KEY
      mockGenerateText.mockResolvedValueOnce(baseResult)

      await executeToolLoop({ model: 'deepseek-chat', systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }] })

      expect(mockGenerateText.mock.calls[0][0].model.__tag).toBe('direct-deepseek')
      expect(mockGenerateText.mock.calls[0][0].providerOptions.deepseek).toEqual({ thinking: { type: 'disabled' } })
    })
  })
})
