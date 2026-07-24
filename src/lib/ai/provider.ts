import { anthropic } from '@ai-sdk/anthropic'
import { deepseek } from '@ai-sdk/deepseek'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'

export type ModelProvider = 'anthropic' | 'deepseek'

export interface ModelConfig {
  provider: ModelProvider
  modelId: string
}

// 21/07/2026: 'deepseek-chat'/'deepseek-reasoner' (nomes de modelo, não os nomes
// amigáveis abaixo) serão descontinuados pela DeepSeek em 2026-07-24 15:59 UTC —
// os dois passam a corresponder ao modo non-thinking e thinking de 'deepseek-v4-flash'
// respectivamente. 'deepseek-chat' (usado ativamente — default de writer/curator/
// publisher/monitor/engagement) já migrado. 'deepseek-reasoner' NÃO é chamado em
// nenhum lugar do código hoje (verificado via grep) — deixado apontando pro nome
// antigo de propósito, pra não colidir com 'deepseek-chat' no MODEL_ID_ALIASES
// (os dois mapeando pro mesmo modelId 'deepseek-v4-flash' quebraria a resolução
// reversa). Se algum dia for ativado, migrar junto com tool-loop.ts passando
// thinking:{type:'enabled'} em vez de 'disabled'.
const MODELS: Record<string, ModelConfig> = {
  'claude-sonnet': { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
  'claude-haiku': { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
  'deepseek-chat': { provider: 'deepseek', modelId: 'deepseek-v4-flash' },
  'deepseek-reasoner': { provider: 'deepseek', modelId: 'deepseek-reasoner' },
}

// Reverse lookup: raw provider model IDs (e.g. 'claude-sonnet-4-6') occasionally
// leak into workspace_settings values instead of the friendly key ('claude-sonnet')
// — found 2026-07-19 in instagram-comments/route.ts's fallback default and in
// stored writer_model settings for two workspaces. Resolving both here means a
// value already saved in either format keeps working instead of throwing.
const MODEL_ID_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(MODELS).map(([friendlyName, config]) => [config.modelId, friendlyName]),
)

function resolveModelName(modelName: string): string {
  return MODELS[modelName] ? modelName : (MODEL_ID_ALIASES[modelName] ?? modelName)
}

export function getModel(modelName: string) {
  const config = MODELS[resolveModelName(modelName)]
  if (!config) {
    throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(MODELS).join(', ')}`)
  }

  switch (config.provider) {
    case 'anthropic':
      return anthropic(config.modelId)
    case 'deepseek':
      return deepseek(config.modelId)
    default:
      throw new Error(`Unknown provider: ${config.provider}`)
  }
}

export function listModels(): string[] {
  return Object.keys(MODELS)
}

// Separate table (not derived from MODELS) so a friendly name can be excluded
// from the OpenRouter tier without touching direct-provider behavior. Slugs
// verified against openrouter.ai — they differ from the direct API model IDs
// above (dots instead of hyphens, no date suffix on Haiku).
//
// deepseek-chat/deepseek-reasoner are DELIBERATELY excluded here — verified
// 2026-07-19 by comparing identical prompts against the direct DeepSeek API
// vs OpenRouter's 'deepseek/deepseek-chat' route (served by "DeepInfra"):
// direct correctly self-identifies as DeepSeek-V3, but the OpenRouter route
// self-identified as GPT-4-0613 — a genuinely different model behind the
// same slug, not a self-identification quirk. 'deepseek/deepseek-reasoner'
// is also not a valid OpenRouter model ID at all. deepseek-chat is the
// default model for writer/curator/publisher/monitor/engagement agents, so
// silently routing it through a different model would have been a real
// regression. Both names return null here — those agents always go direct.
const OPENROUTER_MODELS: Record<string, string> = {
  'claude-sonnet': 'anthropic/claude-sonnet-4.6',
  'claude-haiku': 'anthropic/claude-haiku-4.5',
}

/**
 * Resolve a friendly model name to an OpenRouter-backed model. Returns null
 * (never throws) when OPENROUTER_API_KEY is unset or the name has no
 * OpenRouter mapping — callers must treat null as "skip this tier".
 */
export function getModelViaOpenRouter(modelName: string) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const openRouterModelId = OPENROUTER_MODELS[resolveModelName(modelName)]
  if (!openRouterModelId) return null

  const openrouter = createOpenRouter({ apiKey })
  return openrouter(openRouterModelId)
}
