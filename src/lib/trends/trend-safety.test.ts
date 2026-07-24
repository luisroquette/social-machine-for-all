import { describe, expect, it } from 'vitest'
import { evaluateTrendSafety } from './trend-safety'

describe('trend safety', () => {
  it('bloqueia politica e tragedia', () => {
    expect(evaluateTrendSafety({ topic: 'Debate para presidente', category: 'general' })).toMatchObject({
      status: 'blocked',
    })
    expect(evaluateTrendSafety({ topic: 'Morreu famoso cantor', category: 'entertainment' })).toMatchObject({
      status: 'blocked',
    })
  })

  it('aprova tema seguro e popular', () => {
    const result = evaluateTrendSafety({
      topic: 'ChatGPT no Brasil',
      category: 'technology',
      blockedKeywordsCsv: 'racismo,violencia',
    })
    expect(result).toEqual({ status: 'approved', flags: [] })
  })
})
