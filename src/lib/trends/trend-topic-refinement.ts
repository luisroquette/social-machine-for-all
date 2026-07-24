import { normalizeTrendTopic } from './google-trends'

interface RelatedNewsItem {
  title: string
  source: string
}

const GENERIC_AI_TOPICS = new Set([
  'ai',
  'ia',
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
])

const AI_FAMILY_BY_TOPIC: Record<string, string[]> = {
  gpt: ['gpt', 'chatgpt', 'openai'],
  chatgpt: ['chatgpt', 'gpt', 'openai'],
  openai: ['openai', 'gpt', 'chatgpt'],
  claude: ['claude', 'anthropic'],
  anthropic: ['anthropic', 'claude'],
  gemini: ['gemini', 'google ai'],
}

const PRODUCT_PATTERNS = [
  /\b(gpt[-\s]?\d+(?:\.\d+)?(?:\s+(?:sol|terra|luna|mini|pro|turbo|nano|flash|live|voice|model|models|rollout|launch|coding|agentic|copilot)){0,6})\b/gi,
  /\b(gpt-live voice models?)\b/gi,
  /\b(chatgpt(?:\s+(?:voice|live|agent|agents|search|memory|canvas|study|coding)){0,4})\b/gi,
  /\b(claude(?:\s+(?:code|opus|sonnet|haiku|4|3\.7)){0,4})\b/gi,
  /\b(gemini(?:\s+(?:live|flash|pro|nano|2\.5)){0,4})\b/gi,
  /\b(meta ai(?:\s+(?:image generator|studio|assistant)){0,4})\b/gi,
  /\b(github copilot)\b/gi,
  /\b(voice models?)\b/gi,
]

function cleanCandidate(text: string): string {
  return text
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(models?)\b/gi, 'modelos')
    .replace(/\blaunch\b/gi, '')
    .replace(/\brollout\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = normalizeTrendTopic(value)
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(value.trim())
  }
  return result
}

function isGenericAiTopic(topic: string): boolean {
  return GENERIC_AI_TOPICS.has(normalizeTrendTopic(topic))
}

function getTopicFamily(topic: string): string[] {
  const normalized = normalizeTrendTopic(topic)
  return AI_FAMILY_BY_TOPIC[normalized] ?? [normalized]
}

function extractCandidates(title: string): string[] {
  const candidates: string[] = []

  for (const pattern of PRODUCT_PATTERNS) {
    const matches = Array.from(title.matchAll(pattern))
    for (const match of matches) {
      if (match[1]) candidates.push(cleanCandidate(match[1]))
    }
  }

  return uniqueStrings(candidates).filter((candidate) => candidate.length >= 4)
}

function scoreCandidate(candidate: string, title: string, topicFamily: string[]): number {
  const normalizedCandidate = normalizeTrendTopic(candidate)
  const normalizedTitle = normalizeTrendTopic(title)
  let score = 0

  if (/\d/.test(candidate)) score += 5
  const wordCount = candidate.split(/\s+/).length
  if (wordCount >= 2 && wordCount <= 7) score += 3
  if (/(gpt|chatgpt|openai|claude|gemini|deepseek|llama|copilot|sora|runway|higgsfield|meta ai)/i.test(candidate)) score += 4
  if (/(sol|terra|luna|voice|live|copilot)/i.test(candidate)) score += 3
  if (topicFamily.some((token) => normalizedCandidate.includes(token))) score += 4
  if (normalizedTitle.includes(normalizedCandidate)) score += 2

  return score
}

export function refineTrendTopic(input: {
  topic: string
  relatedNews: RelatedNewsItem[]
}): {
  sourceTopic: string
  editorialTopic: string
  refined: boolean
  matchedHeadline?: string
} {
  if (!isGenericAiTopic(input.topic)) {
    return {
      sourceTopic: input.topic,
      editorialTopic: input.topic,
      refined: false,
    }
  }

  const topicFamily = getTopicFamily(input.topic)
  const ranked = input.relatedNews
    .flatMap((news) => extractCandidates(news.title).map((candidate) => ({
      candidate,
      title: news.title,
      score: scoreCandidate(candidate, news.title, topicFamily),
    })))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < 7) {
    return {
      sourceTopic: input.topic,
      editorialTopic: input.topic,
      refined: false,
    }
  }

  return {
    sourceTopic: input.topic,
    editorialTopic: best.candidate,
    refined: normalizeTrendTopic(best.candidate) !== normalizeTrendTopic(input.topic),
    matchedHeadline: best.title,
  }
}
