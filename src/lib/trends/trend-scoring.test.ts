import { describe, expect, it, vi } from 'vitest'
import { scoreTrendTopicDetailed } from './trend-scoring'

describe('trend scoring', () => {
  it('prioriza trend fresco, visual e emocionalmente forte', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-07T12:00:00.000Z'))

    const result = scoreTrendTopicDetailed({
      topic: 'Jorge Jesus assume Portugal',
      category: 'sports',
      volumeScore: 250_000,
      relatedNewsCount: 3,
      relatedText: 'final torcida estadio revolucao tática',
      publishedAt: '2026-07-07T10:30:00.000Z',
    })

    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.breakdown.visualPotential).toBeGreaterThanOrEqual(14)
    expect(result.breakdown.freshness).toBe(18)

    vi.useRealTimers()
  })

  it('penaliza trend com risco de polemica mesmo que tenha volume', () => {
    const result = scoreTrendTopicDetailed({
      topic: 'Briga em debate para presidente',
      category: 'general',
      volumeScore: 500_000,
      relatedNewsCount: 2,
      relatedText: 'eleicao partido ataque agressao',
      publishedAt: null,
    })

    expect(result.breakdown.controversyPenalty).toBeGreaterThanOrEqual(10)
    expect(result.score).toBeLessThan(65)
  })
})
