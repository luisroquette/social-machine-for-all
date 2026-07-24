import { normalizeTrendTopic } from './google-trends'

const AI_TOPIC_SEEDS = [
  'gpt',
  'chatgpt',
  'openai',
  'claude',
  'anthropic',
  'gemini',
  'google ai',
  'deepseek',
  'llm',
  'meta ai',
  'llama',
  'copilot',
  'midjourney',
  'sora',
  'runway',
  'higgsfield',
  'perplexity',
  'grok',
  'codex',
  'cursor',
]

function containsAiSeed(topic: string): boolean {
  const normalized = normalizeTrendTopic(topic)
  return AI_TOPIC_SEEDS.some((seed) => normalized.includes(normalizeTrendTopic(seed)))
}

export function evaluateTrendTopicSeed(input: {
  topic: string
  relatedText?: string
}): {
  approved: boolean
  reason: 'ai_seed' | 'related_alignment' | 'numeric_noise' | 'seed_not_aligned'
} {
  const normalizedTopic = normalizeTrendTopic(input.topic)
  const normalizedRelatedText = normalizeTrendTopic(input.relatedText ?? '')

  if (!normalizedTopic || /^\d+$/.test(normalizedTopic)) {
    return { approved: false, reason: 'numeric_noise' }
  }

  if (containsAiSeed(normalizedTopic)) {
    return { approved: true, reason: 'ai_seed' }
  }

  if (normalizedTopic.length >= 4 && normalizedRelatedText.includes(normalizedTopic)) {
    return { approved: true, reason: 'related_alignment' }
  }

  return { approved: false, reason: 'seed_not_aligned' }
}
