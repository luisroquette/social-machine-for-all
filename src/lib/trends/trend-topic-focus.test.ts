import { describe, expect, it } from 'vitest'
import { matchesTrendFocus } from './trend-topic-focus'

describe('matchesTrendFocus', () => {
  it('aprova tema com sinal claro de IA no topico', () => {
    const result = matchesTrendFocus({
      topic: 'GPT 5.6 Sol Luna Terra',
      requiredKeywordsCsv: 'gpt,openai,claude',
    })

    expect(result.matches).toBe(true)
    expect(result.matchedKeywords).toContain('gpt')
  })

  it('aprova tema quando o sinal de IA aparece na noticia relacionada', () => {
    const result = matchesTrendFocus({
      topic: 'Sol',
      relatedText: 'OpenAI lança GPT 5.6 com Sol, Luna e Terra',
      requiredKeywordsCsv: 'gpt,openai,claude',
    })

    expect(result.matches).toBe(true)
    expect(result.matchedKeywords).toEqual(expect.arrayContaining(['gpt', 'openai']))
  })

  it('bloqueia tema generico sem sinal de IA', () => {
    const result = matchesTrendFocus({
      topic: 'Aviao',
      relatedText: 'Acidente de aviao em Santa Catarina',
      requiredKeywordsCsv: 'gpt,openai,claude',
    })

    expect(result.matches).toBe(false)
    expect(result.matchedKeywords).toEqual([])
  })

  it('bloqueia tema generico com apenas um sinal fraco de IA nas noticias', () => {
    const result = matchesTrendFocus({
      topic: 'BR-040',
      relatedText: 'BBC fala de golpes com inteligencia artificial, mas o resto do noticiario e sobre acidente',
      requiredKeywordsCsv: 'gpt,openai,claude,inteligencia artificial',
    })

    expect(result.matches).toBe(false)
    expect(result.matchedKeywords).toEqual(['inteligencia artificial'])
  })
})
