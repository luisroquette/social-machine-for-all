export interface TrendSafetyResult {
  status: 'approved' | 'blocked'
  flags: string[]
}

const HARD_BLOCKED_PATTERNS: Array<{ pattern: RegExp; flag: string }> = [
  { pattern: /\b(racismo|racista|homofobia|nazismo|antissemitismo)\b/i, flag: 'hate' },
  { pattern: /\b(morte|morreu|obituario|obituário|velorio|velório|assassinato|homicidio|homicídio)\b/i, flag: 'death_violence' },
  { pattern: /\b(briga|agressao|agressão|tiroteio|ataque|guerra|explosao|explosão)\b/i, flag: 'violence' },
  { pattern: /\b(eleicao|eleição|eleições|partido|presidente|governador|prefeito|senador|deputado|bolsonaro|lula)\b/i, flag: 'politics' },
]

export function evaluateTrendSafety(input: {
  topic: string
  category?: string
  relatedText?: string
  blockedKeywordsCsv?: string
}): TrendSafetyResult {
  const text = [input.topic, input.category ?? '', input.relatedText ?? ''].join(' ').toLowerCase()
  const flags = new Set<string>()

  for (const rule of HARD_BLOCKED_PATTERNS) {
    if (rule.pattern.test(text)) flags.add(rule.flag)
  }

  const blockedKeywords = (input.blockedKeywordsCsv ?? '')
    .split(',')
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean)

  for (const keyword of blockedKeywords) {
    if (text.includes(keyword)) flags.add(`blocked:${keyword}`)
  }

  if (flags.size > 0) {
    return { status: 'blocked', flags: Array.from(flags) }
  }

  return { status: 'approved', flags: [] }
}
