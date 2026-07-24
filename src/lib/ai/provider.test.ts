import { afterEach, describe, expect, it } from 'vitest'
import { getModel, getModelViaOpenRouter, listModels } from './provider'

describe('getModelViaOpenRouter', () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY
  })

  it('returns null without throwing when OPENROUTER_API_KEY is unset', () => {
    delete process.env.OPENROUTER_API_KEY
    expect(getModelViaOpenRouter('claude-sonnet')).toBeNull()
  })

  it('returns null without throwing for a model name with no OpenRouter mapping', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    expect(getModelViaOpenRouter('nonexistent-model')).toBeNull()
  })

  it('returns a model object for a mapped name when the key is set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    expect(getModelViaOpenRouter('claude-sonnet')).not.toBeNull()
    expect(getModelViaOpenRouter('claude-haiku')).not.toBeNull()
  })

  // REGRESSÃO 2026-07-19: verificado ao vivo que o slug 'deepseek/deepseek-chat'
  // no OpenRouter (provider "DeepInfra") NÃO é o mesmo modelo da API direta da
  // DeepSeek — o direto se identifica corretamente como DeepSeek-V3, o do
  // OpenRouter se identificou como GPT-4-0613 com o prompt idêntico. E
  // 'deepseek/deepseek-reasoner' nem é um model ID válido no OpenRouter.
  // deepseek-chat é o modelo padrão de writer/curator/publisher/monitor/
  // engagement — NUNCA reintroduzir esses dois no tier OpenRouter sem
  // reverificar contra a API oficial primeiro.
  it('NUNCA mapeia deepseek-chat/deepseek-reasoner para o tier OpenRouter (modelo divergente verificado)', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    expect(getModelViaOpenRouter('deepseek-chat')).toBeNull()
    expect(getModelViaOpenRouter('deepseek-reasoner')).toBeNull()
  })
})

describe('getModel (direct provider) — unchanged by the OpenRouter addition', () => {
  it('still resolves known models directly', () => {
    expect(() => getModel('claude-sonnet')).not.toThrow()
    expect(() => getModel('claude-haiku')).not.toThrow()
  })

  it('still throws for unknown models', () => {
    expect(() => getModel('nonexistent-model')).toThrow(/Unknown model/)
  })
})

describe('listModels — unchanged by the OpenRouter addition', () => {
  it('lists only the direct MODELS table, not the OpenRouter-only table', () => {
    expect(listModels()).toEqual(['claude-sonnet', 'claude-haiku', 'deepseek-chat', 'deepseek-reasoner'])
  })
})

// REGRESSÃO 2026-07-21: 'deepseek-chat' (nome de modelo da API, não o nome amigável
// abaixo) será descontinuado pela DeepSeek em 2026-07-24 15:59 UTC — passa a
// corresponder ao modo non-thinking de 'deepseek-v4-flash'. O nome amigável
// 'deepseek-chat' continua existindo (nada muda pros chamadores), só o modelId
// por trás dele migrou. Sem isso, toda chamada com o nome amigável 'deepseek-chat'
// pararia de funcionar a partir daquela data.
describe('REGRESSÃO: deepseek-chat migrado pro modelId deepseek-v4-flash (deprecação 2026-07-24)', () => {
  it('getModel("deepseek-chat") resolve pro modelId deepseek-v4-flash, não mais deepseek-chat', () => {
    const model = getModel('deepseek-chat') as { modelId?: string }
    expect(model.modelId).toBe('deepseek-v4-flash')
  })

  it('getModel("deepseek-v4-flash") (raw modelId) resolve pelo alias reverso, mesmo padrão de claude-sonnet-4-6', () => {
    expect(() => getModel('deepseek-v4-flash')).not.toThrow()
    const model = getModel('deepseek-v4-flash') as { modelId?: string }
    expect(model.modelId).toBe('deepseek-v4-flash')
  })
})

// REGRESSÃO 2026-07-19: descoberta ao auditar os leitores de workspace_settings
// que alimentam getModel(). Dois pontos armazenam o RAW model ID em vez do
// nome amigável:
//   - instagram-comments/route.ts:106 — fallback 'claude-haiku-4-5-20251001'
//     quando engagement_model não está configurado (nenhum workspace tem —
//     bug ATIVO agora: toda resposta de comentário quebra com "Unknown model")
//   - workspace_settings.writer_model = 'claude-sonnet-4-6' (ai-tech e
//     brand-mob) — mascarado hoje porque agents.model tem prioridade, mas
//     quebraria assim que essa coluna fosse limpa
// Fix: getModel()/getModelViaOpenRouter() também resolvem pelo raw modelId
// (alias reverso), então qualquer valor já gravado no banco nesse formato
// continua funcionando em vez de lançar erro.
describe('REGRESSÃO: getModel() resolve tanto o nome amigável quanto o raw model ID', () => {
  it('resolve claude-sonnet-4-6 (raw ID) do mesmo jeito que claude-sonnet (nome amigável)', () => {
    expect(() => getModel('claude-sonnet-4-6')).not.toThrow()
  })

  it('resolve claude-haiku-4-5-20251001 (raw ID, o fallback quebrado do instagram-comments) sem lançar erro', () => {
    expect(() => getModel('claude-haiku-4-5-20251001')).not.toThrow()
  })

  it('getModelViaOpenRouter também resolve pelo raw ID, não só pelo nome amigável', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    expect(getModelViaOpenRouter('claude-sonnet-4-6')).not.toBeNull()
    expect(getModelViaOpenRouter('claude-haiku-4-5-20251001')).not.toBeNull()
    delete process.env.OPENROUTER_API_KEY
  })

  it('nomes genuinamente desconhecidos (nem amigável nem raw ID) continuam lançando erro', () => {
    expect(() => getModel('totally-made-up-model')).toThrow(/Unknown model/)
  })
})
