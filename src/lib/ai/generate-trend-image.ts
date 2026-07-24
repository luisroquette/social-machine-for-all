import { generateStoredImageWithMetadata, type StoredImageGenerationResult } from './openai-image'

function strengthenTrendImagePrompt(prompt: string): string {
  return [
    prompt.trim(),
    'Frame capturado no meio de uma acao real.',
    'Sem pose estatica.',
    'Sem retrato centralizado olhando para a camera.',
    'Foreground, midground e background reagindo ao evento.',
    'Energia de filme, nao poster parado.',
  ].join(' ')
}

export interface TrendImageGenerationResult extends StoredImageGenerationResult {
  promptOriginal: string
  promptFinal: string
}

export async function generateTrendImageAsset(params: {
  itemId: string
  prompt: string
  providerChain?: string[] | string
}): Promise<TrendImageGenerationResult | null> {
  const strengthenedPrompt = strengthenTrendImagePrompt(params.prompt)
  const result = await generateStoredImageWithMetadata({
    prompt: strengthenedPrompt,
    path: `trend-videos/images/${params.itemId}.png`,
    bucket: 'reels',
    size: '1024x1536',
    providerChain: params.providerChain,
  })

  if (!result) return null

  return {
    ...result,
    promptOriginal: params.prompt,
    promptFinal: strengthenedPrompt,
  }
}

export async function generateTrendImage(params: {
  itemId: string
  prompt: string
}): Promise<string | null> {
  return (await generateTrendImageAsset(params))?.url ?? null
}
