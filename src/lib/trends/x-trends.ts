import { XClient } from '@/lib/platforms/x/client'
import { normalizeTrendTopic } from './google-trends'

export interface XTrendTopic {
  source: 'x_trending'
  countryCode: string
  topic: string
  normalizedTopic: string
  volumeLabel: string
  volumeScore: number
  publishedAt: string | null
  category: string
  relatedNews: []
  rawPayload: Record<string, unknown>
}

function classifyTopic(text: string): string {
  const value = text.toLowerCase()

  if (/\b(futebol|volei|vôlei|nba|ufc|copa|olimpi|tenis|f1|formula 1|flamengo|palmeiras|corinthians)\b/.test(value)) {
    return 'sports'
  }
  if (/\b(claude|chatgpt|gpt|openai|gemini|anthropic|ia|inteligencia artificial|ai|deepseek|midjourney|sora)\b/.test(value)) {
    return 'technology'
  }
  if (/\b(bbb|novela|cantor|cantora|atriz|ator|filme|serie|série|netflix|show|celebridade|famoso|famosa|anitta)\b/.test(value)) {
    return 'entertainment'
  }
  if (/\b(anime|manga|mangá|marvel|dc|games|game|pokemon|pokémon)\b/.test(value)) {
    return 'pop_culture'
  }
  return 'general'
}

function formatTweetCount(value: number | null): string {
  if (!value || value <= 0) return 'Trending on X'
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M+ posts`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K+ posts`
  return `${value}+ posts`
}

function countryCodeToWoeid(countryCode: string): number {
  if (countryCode.toUpperCase() === 'BR') return 23424768
  return 1
}

export async function fetchXTrendingTopics(params?: {
  countryCode?: string
}): Promise<XTrendTopic[]> {
  const countryCode = (params?.countryCode ?? 'BR').toUpperCase()
  if (!process.env.TWITTER_API_KEY || !process.env.TWITTER_API_SECRET) {
    return []
  }

  const trends = await XClient.fromEnv().getTrending(countryCodeToWoeid(countryCode))
  return trends.map((trend, index) => ({
    source: 'x_trending',
    countryCode,
    topic: trend.name,
    normalizedTopic: normalizeTrendTopic(trend.name),
    volumeLabel: formatTweetCount(trend.tweetCount),
    volumeScore: trend.tweetCount ?? Math.max(0, 10_000 - (index * 250)),
    publishedAt: null,
    category: classifyTopic(trend.name),
    relatedNews: [],
    rawPayload: {
      name: trend.name,
      tweetCount: trend.tweetCount,
      rank: index + 1,
      woeid: countryCodeToWoeid(countryCode),
    },
  }))
}
