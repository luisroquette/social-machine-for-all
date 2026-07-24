import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-topics-rerank/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-topics-rerank', () => {
  it('recalcula adaptive_trend_score para topicos new aprovados', () => {
    expect(SRC).toContain("from('br_trend_topics')")
    expect(SRC).toMatch(/\.eq\('status', 'new'\)/)
    expect(SRC).toMatch(/\.eq\('safety_status', 'approved'\)/)
    expect(SRC).toMatch(/scoreAdaptiveTrendTopic\(/)
  })

  it('atualiza raw_payload e rank_position retroativamente', () => {
    expect(SRC).toMatch(/rank_position: index \+ 1/)
    expect(SRC).toMatch(/adaptive_trend_score: topic\.adaptiveTrendScore/)
    expect(SRC).toMatch(/learning_summary:/)
  })

  it('retorna resumo do rerank', () => {
    expect(SRC).toMatch(/reranked: rankedTopics\.length/)
    expect(SRC).toMatch(/base_trend_score:/)
    expect(SRC).toMatch(/adaptive_trend_score:/)
  })
})
