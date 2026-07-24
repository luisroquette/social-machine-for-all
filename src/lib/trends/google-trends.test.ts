import { describe, expect, it } from 'vitest'
import { normalizeTrendTopic, parseGoogleTrendsRss } from './google-trends'

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
  <channel>
    <item>
      <title>ChatGPT</title>
      <ht:approx_traffic>20000+</ht:approx_traffic>
      <pubDate>Mon, 6 Jul 2026 15:00:00 -0700</pubDate>
      <ht:news_item>
        <ht:news_item_title>ChatGPT vira assunto no Brasil</ht:news_item_title>
        <ht:news_item_url>https://example.com/chatgpt</ht:news_item_url>
        <ht:news_item_source>Portal Tech</ht:news_item_source>
      </ht:news_item>
    </item>
    <item>
      <title>Flamengo</title>
      <ht:approx_traffic>5000+</ht:approx_traffic>
      <pubDate>Mon, 6 Jul 2026 16:00:00 -0700</pubDate>
    </item>
  </channel>
</rss>`

describe('google trends rss parser', () => {
  it('normaliza topico para dedup', () => {
    expect(normalizeTrendTopic('Vôlei Feminino!')).toBe('volei feminino')
  })

  it('parseia feed oficial do google trends', () => {
    const topics = parseGoogleTrendsRss(SAMPLE_RSS, 'BR')
    expect(topics).toHaveLength(2)
    expect(topics[0]).toMatchObject({
      source: 'google_trends',
      countryCode: 'BR',
      topic: 'ChatGPT',
      normalizedTopic: 'chatgpt',
      volumeScore: 20000,
      category: 'technology',
    })
    expect(topics[0].relatedNews[0]?.source).toBe('Portal Tech')
    expect(topics[1]?.category).toBe('sports')
  })
})
