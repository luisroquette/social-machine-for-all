import { normalizeTrendTopic } from './google-trends'

function parseCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

export function matchesTrendFocus(input: {
  topic: string
  relatedText?: string
  requiredKeywordsCsv?: string
}): { matches: boolean; matchedKeywords: string[] } {
  const requiredKeywords = parseCsv(input.requiredKeywordsCsv ?? '')
    .map((keyword) => normalizeTrendTopic(keyword))
    .filter(Boolean)

  if (requiredKeywords.length === 0) {
    return { matches: true, matchedKeywords: [] }
  }

  const normalizedTopic = normalizeTrendTopic(input.topic)
  const haystack = normalizeTrendTopic([input.topic, input.relatedText ?? ''].join(' '))
  const matchedKeywords = requiredKeywords.filter((keyword) => haystack.includes(keyword))
  const matchedTopicKeywords = requiredKeywords.filter((keyword) => normalizedTopic.includes(keyword))

  return {
    matches: matchedTopicKeywords.length > 0 || matchedKeywords.length >= 2,
    matchedKeywords,
  }
}
