interface TrendScoringInput {
  topic: string
  category: string
  volumeScore: number
  relatedNewsCount: number
  relatedText?: string
  publishedAt?: string | null
}

export interface TrendScoreBreakdown {
  volume: number
  freshness: number
  visualPotential: number
  emotionalPotential: number
  shortViralFit: number
  controversyPenalty: number
}

export interface TrendScoreResult {
  score: number
  breakdown: TrendScoreBreakdown
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function scoreVolume(volumeScore: number): number {
  if (volumeScore >= 1_000_000) return 30
  if (volumeScore >= 300_000) return 26
  if (volumeScore >= 100_000) return 22
  if (volumeScore >= 50_000) return 18
  if (volumeScore >= 10_000) return 14
  if (volumeScore >= 5_000) return 10
  return 6
}

function scoreFreshness(publishedAt?: string | null): number {
  if (!publishedAt) return 10
  const hours = (Date.now() - new Date(publishedAt).getTime()) / 3_600_000
  if (hours <= 2) return 18
  if (hours <= 6) return 16
  if (hours <= 12) return 14
  if (hours <= 24) return 11
  if (hours <= 48) return 7
  return 4
}

function scoreVisualPotential(topic: string, category: string, relatedText: string): number {
  const text = `${topic} ${relatedText}`.toLowerCase()
  let score =
    category === 'sports' ? 15 :
    category === 'entertainment' ? 14 :
    category === 'technology' ? 13 :
    category === 'pop_culture' ? 14 : 9

  if (/\b(video|foto|imagem|trailer|gol|final|show|estreia|robo|robô|carro|avatar|uniforme|palco|estadio|estádio)\b/.test(text)) score += 2
  if (/\b(claude|chatgpt|gpt|openai|gemini|anitta|netflix|flamengo|palmeiras|corinthians|jorge jesus)\b/.test(text)) score += 1
  return clamp(score, 0, 18)
}

function scoreEmotionalPotential(topic: string, category: string, relatedText: string): number {
  const text = `${topic} ${relatedText}`.toLowerCase()
  let score =
    category === 'sports' ? 11 :
    category === 'entertainment' ? 12 :
    category === 'technology' ? 9 :
    category === 'pop_culture' ? 10 : 8

  if (/\b(revolucao|revolução|estreia|final|recorde|virou|surpreende|assume|volta|choque|bastidor|revela)\b/.test(text)) score += 2
  if (/\b(x|vs|contra|rival|polêmica|treta)\b/.test(text)) score += 1
  return clamp(score, 0, 14)
}

function scoreShortViralFit(topic: string, category: string, relatedNewsCount: number): number {
  const wordCount = topic.trim().split(/\s+/).filter(Boolean).length
  let score =
    category === 'technology' ? 10 :
    category === 'sports' ? 11 :
    category === 'entertainment' ? 11 :
    category === 'pop_culture' ? 10 : 8

  if (wordCount <= 5) score += 3
  else if (wordCount <= 8) score += 2
  else score -= 1

  if (relatedNewsCount >= 2) score += 2
  return clamp(score, 0, 20)
}

function scoreControversyPenalty(topic: string, relatedText: string): number {
  const text = `${topic} ${relatedText}`.toLowerCase()
  let penalty = 0
  if (/\b(briga|treta|agressao|agressão|ataque)\b/.test(text)) penalty += 5
  if (/\b(morte|morreu|assassinato|homicidio|homicídio)\b/.test(text)) penalty += 12
  if (/\b(eleicao|eleição|presidente|governo|partido|lula|bolsonaro)\b/.test(text)) penalty += 12
  if (/\b(racismo|racista|nazismo|homofobia)\b/.test(text)) penalty += 15
  return clamp(penalty, 0, 20)
}

export function scoreTrendTopicDetailed(input: TrendScoringInput): TrendScoreResult {
  const relatedText = input.relatedText ?? ''
  const breakdown: TrendScoreBreakdown = {
    volume: scoreVolume(input.volumeScore),
    freshness: scoreFreshness(input.publishedAt),
    visualPotential: scoreVisualPotential(input.topic, input.category, relatedText),
    emotionalPotential: scoreEmotionalPotential(input.topic, input.category, relatedText),
    shortViralFit: scoreShortViralFit(input.topic, input.category, input.relatedNewsCount),
    controversyPenalty: scoreControversyPenalty(input.topic, relatedText),
  }

  const score = clamp(
    breakdown.volume +
      breakdown.freshness +
      breakdown.visualPotential +
      breakdown.emotionalPotential +
      breakdown.shortViralFit -
      breakdown.controversyPenalty,
    0,
    100,
  )

  return { score, breakdown }
}

export function scoreTrendTopic(input: TrendScoringInput): number {
  return scoreTrendTopicDetailed(input).score
}
