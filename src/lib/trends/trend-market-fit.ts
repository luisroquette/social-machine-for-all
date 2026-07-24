import { normalizeTrendTopic } from './google-trends'

interface RelatedNewsItem {
  title: string
  source: string
}

const STRONG_AI_KEYWORDS = [
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
]

const BRAZILIAN_SOURCE_KEYWORDS = [
  'g1',
  'uol',
  'folha',
  'estadao',
  'estadão',
  'tecmundo',
  'canaltech',
  'olhar digital',
  'exame',
  'valor',
  'cnn brasil',
  'techtudo',
  'neofeed',
]

const BRAZIL_SIGNAL_REGEX = /\b(brasil|brasileiro|brasileira|portugues|português|portuguesa|portuguese|sao paulo|rio de janeiro)\b/i

function countMatches(haystack: string, needles: string[]): number {
  return needles.filter((needle) => haystack.includes(normalizeTrendTopic(needle))).length
}

export function scoreTrendBrazilAiFit(input: {
  topic: string
  source: 'google_trends' | 'x_trending'
  relatedNews: RelatedNewsItem[]
  countryCode: string
}): {
  approved: boolean
  score: number
  aiKeywordMatches: number
  brazilianSourceMatches: number
  brazilSignalMatches: number
} {
  const normalizedTopic = normalizeTrendTopic(input.topic)
  const relatedText = normalizeTrendTopic(
    input.relatedNews.map((news) => `${news.title} ${news.source}`).join(' '),
  )
  const brazilSignalMatches = [
    BRAZIL_SIGNAL_REGEX.test(input.topic) ? 1 : 0,
    ...input.relatedNews.map((news) => (BRAZIL_SIGNAL_REGEX.test(news.title) ? 1 : 0)),
  ].reduce((sum, value) => sum + value, 0)
  const brazilianSourceMatches = input.relatedNews.filter((news) =>
    BRAZILIAN_SOURCE_KEYWORDS.some((keyword) => normalizeTrendTopic(news.source).includes(normalizeTrendTopic(keyword))),
  ).length
  const aiKeywordMatches =
    countMatches(normalizedTopic, STRONG_AI_KEYWORDS) +
    countMatches(relatedText, STRONG_AI_KEYWORDS)

  const topicHasStrongAiSignal = STRONG_AI_KEYWORDS.some((keyword) => normalizedTopic.includes(normalizeTrendTopic(keyword)))
  const hasBrazilContext = input.countryCode.toUpperCase() === 'BR' || brazilSignalMatches > 0 || brazilianSourceMatches > 0

  let score = 0
  if (topicHasStrongAiSignal) score += 8
  if (aiKeywordMatches >= 2) score += 4
  if (brazilianSourceMatches > 0) score += Math.min(4, brazilianSourceMatches * 2)
  if (brazilSignalMatches > 0) score += Math.min(3, brazilSignalMatches)
  if (hasBrazilContext) score += 2
  if (input.source === 'google_trends' && input.relatedNews.length >= 2) score += 2
  if (input.source === 'x_trending' && !topicHasStrongAiSignal) score -= 6

  return {
    approved: topicHasStrongAiSignal || (aiKeywordMatches >= 2 && hasBrazilContext),
    score,
    aiKeywordMatches,
    brazilianSourceMatches,
    brazilSignalMatches,
  }
}
