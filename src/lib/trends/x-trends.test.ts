import { afterEach, describe, expect, it, vi } from 'vitest'

const getTrending = vi.fn()

vi.mock('@/lib/platforms/x/client', () => ({
  XClient: {
    fromEnv: () => ({
      getTrending,
    }),
  },
}))

import { fetchXTrendingTopics } from './x-trends'

describe('x trending collector', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
    getTrending.mockReset()
  })

  it('mapeia trends do X para o formato do pipeline', async () => {
    process.env.TWITTER_API_KEY = 'key'
    process.env.TWITTER_API_SECRET = 'secret'
    getTrending.mockResolvedValue([
      { name: 'Jorge Jesus', tweetCount: 128000 },
      { name: 'ChatGPT', tweetCount: 98000 },
    ])

    const topics = await fetchXTrendingTopics({ countryCode: 'BR' })

    expect(topics).toHaveLength(2)
    expect(topics[0]).toMatchObject({
      source: 'x_trending',
      countryCode: 'BR',
      topic: 'Jorge Jesus',
      normalizedTopic: 'jorge jesus',
      volumeLabel: '128K+ posts',
      volumeScore: 128000,
      category: 'general',
    })
    expect(topics[1].category).toBe('technology')
  })
})
