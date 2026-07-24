import { describe, expect, it } from 'vitest'
import { scoreTrendBrazilAiFit } from './trend-market-fit'

describe('scoreTrendBrazilAiFit', () => {
  it('aprova lancamento forte de IA mesmo quando o tema e global', () => {
    const result = scoreTrendBrazilAiFit({
      topic: 'gpt',
      source: 'google_trends',
      countryCode: 'BR',
      relatedNews: [
        { source: 'OpenAI', title: 'GPT-5.6: Frontier intelligence that scales with your ambition' },
        { source: 'GitHub Blog', title: 'GPT-5.6 Sol, Terra, and Luna are now available in GitHub Copilot' },
      ],
    })

    expect(result.approved).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(10)
  })

  it('da boost para noticia de IA com fonte brasileira', () => {
    const result = scoreTrendBrazilAiFit({
      topic: 'chatgpt',
      source: 'google_trends',
      countryCode: 'BR',
      relatedNews: [
        { source: 'Canaltech', title: 'ChatGPT ganha modo de voz e vira assunto no Brasil' },
        { source: 'G1', title: 'Brasileiros testam novo ChatGPT com voz em portugues' },
      ],
    })

    expect(result.approved).toBe(true)
    expect(result.brazilianSourceMatches).toBeGreaterThanOrEqual(2)
    expect(result.brazilSignalMatches).toBeGreaterThanOrEqual(1)
  })

  it('rejeita trend do X sem sinal forte de IA', () => {
    const result = scoreTrendBrazilAiFit({
      topic: 'microsoft',
      source: 'x_trending',
      countryCode: 'BR',
      relatedNews: [],
    })

    expect(result.approved).toBe(false)
    expect(result.score).toBeLessThan(8)
  })
})
