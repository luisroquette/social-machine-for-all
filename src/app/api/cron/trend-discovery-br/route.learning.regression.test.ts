import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-discovery-br/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-discovery-br learning', () => {
  it('calcula adaptiveTrendScore na descoberta', () => {
    expect(SRC).toMatch(/scoreAdaptiveTrendTopic\(/)
    expect(SRC).toMatch(/buildTrendLearningPack\(/)
  })

  it('persiste base e adaptive score no raw_payload', () => {
    expect(SRC).toMatch(/base_trend_score: trendScore\.score/)
    expect(SRC).toMatch(/adaptive_trend_score: adaptiveTrendScore/)
    expect(SRC).toMatch(/learning_summary:/)
  })

  it('ordena rows pelo adaptive score antes do insert', () => {
    expect(SRC).toMatch(/adaptiveB - adaptiveA/)
    expect(SRC).toMatch(/rank_position: index \+ 1/)
  })
})
