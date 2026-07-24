export interface TrendNewsItem {
  title: string
  url: string
  source: string
}

export interface GoogleTrendTopic {
  source: 'google_trends'
  countryCode: string
  topic: string
  normalizedTopic: string
  volumeLabel: string
  volumeScore: number
  publishedAt: string | null
  category: string
  relatedNews: TrendNewsItem[]
  rawPayload: Record<string, unknown>
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
}

function extractTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'))
  return match ? decodeXml(match[1]) : ''
}

function extractBlocks(block: string, tag: string): string[] {
  return Array.from(block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi'))).map((match) => match[1])
}

export function normalizeTrendTopic(topic: string): string {
  return topic
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseVolumeScore(volumeLabel: string): number {
  const normalized = volumeLabel.toLowerCase().replace(/\./g, '').replace(/\s+/g, '')
  const match = normalized.match(/(\d+)/)
  if (!match) return 0

  const base = parseInt(match[1], 10)
  if (normalized.includes('milhao') || normalized.includes('mi') || normalized.includes('m+')) return base * 1_000_000
  if (normalized.includes('mil') || normalized.includes('k+')) return base * 1_000
  return base
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

export function parseGoogleTrendsRss(xml: string, countryCode = 'BR'): GoogleTrendTopic[] {
  const items = extractBlocks(xml, 'item')

  return items.map((item): GoogleTrendTopic | null => {
    const topic = extractTag(item, 'title')
    if (!topic) return null

    const volumeLabel = extractTag(item, 'ht:approx_traffic')
    const pubDate = extractTag(item, 'pubDate')
    const newsBlocks = extractBlocks(item, 'ht:news_item')
    const relatedNews = newsBlocks
      .map((news): TrendNewsItem | null => {
        const title = extractTag(news, 'ht:news_item_title')
        const url = extractTag(news, 'ht:news_item_url')
        const source = extractTag(news, 'ht:news_item_source')
        if (!title || !url) return null
        return { title, url, source }
      })
      .filter((news): news is TrendNewsItem => news !== null)

    const rawText = [topic, ...relatedNews.map((news) => `${news.title} ${news.source}`)].join(' ')
    return {
      source: 'google_trends',
      countryCode,
      topic,
      normalizedTopic: normalizeTrendTopic(topic),
      volumeLabel,
      volumeScore: parseVolumeScore(volumeLabel),
      publishedAt: pubDate ? new Date(pubDate).toISOString() : null,
      category: classifyTopic(rawText),
      relatedNews,
      rawPayload: {
        topic,
        volumeLabel,
        pubDate,
        relatedNews,
      },
    }
  }).filter((item): item is GoogleTrendTopic => item !== null)
}

export async function fetchGoogleTrendsRss(params?: {
  countryCode?: string
  signal?: AbortSignal
}): Promise<GoogleTrendTopic[]> {
  const countryCode = (params?.countryCode ?? 'BR').toUpperCase()
  const res = await fetch(`https://trends.google.com/trending/rss?geo=${encodeURIComponent(countryCode)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 SocialMachineTrendCollector/1.0' },
    signal: params?.signal ?? AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(`Google Trends RSS failed: ${res.status}`)
  }

  const xml = await res.text()
  return parseGoogleTrendsRss(xml, countryCode)
}
