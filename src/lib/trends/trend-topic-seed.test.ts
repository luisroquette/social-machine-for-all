import { describe, expect, it } from 'vitest'
import { evaluateTrendTopicSeed } from './trend-topic-seed'

describe('evaluateTrendTopicSeed', () => {
  it('rejeita topico numerico', () => {
    expect(evaluateTrendTopicSeed({ topic: '6', relatedText: 'GPT-5.6 OpenAI' })).toEqual({
      approved: false,
      reason: 'numeric_noise',
    })
  })

  it('aprova seed explicita de IA', () => {
    expect(evaluateTrendTopicSeed({ topic: 'chatgpt', relatedText: '' })).toEqual({
      approved: true,
      reason: 'ai_seed',
    })
  })

  it('rejeita seed desalinhada com as noticias', () => {
    expect(evaluateTrendTopicSeed({
      topic: 'mark zuckerberg',
      relatedText: 'Introducing Muse Spark 1.1 Meta superintelligence and AI coding market',
    })).toEqual({
      approved: false,
      reason: 'seed_not_aligned',
    })
  })
})
