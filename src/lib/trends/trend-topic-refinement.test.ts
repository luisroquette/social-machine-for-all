import { describe, expect, it } from 'vitest'
import { refineTrendTopic } from './trend-topic-refinement'

describe('refineTrendTopic', () => {
  it('transforma gpt em pauta especifica do lancamento', () => {
    const result = refineTrendTopic({
      topic: 'gpt',
      relatedNews: [
        { source: 'OpenAI', title: 'GPT-5.6: Frontier intelligence that scales with your ambition' },
        { source: 'CNBC', title: "OpenAI's newest AI model is 54% more token efficient on agentic coding" },
        { source: 'GitHub', title: 'OpenAI’s GPT-5.6 Sol, Terra, and Luna are now available in GitHub Copilot' },
      ],
    })

    expect(result.refined).toBe(true)
    expect(result.editorialTopic).toContain('GPT-5.6')
  })

  it('transforma chatgpt em angulo de voz quando as noticias apontam isso', () => {
    const result = refineTrendTopic({
      topic: 'chatgpt',
      relatedNews: [
        { source: 'Reuters', title: 'OpenAI launches GPT-Live voice models that listen and speak simultaneously' },
        { source: 'TechCrunch', title: 'OpenAI releases new voice models for more natural live conversations' },
      ],
    })

    expect(result.refined).toBe(true)
    expect(result.editorialTopic).toMatch(/GPT-Live|voice modelos/i)
  })

  it('nao mexe em tema que ja e especifico', () => {
    const result = refineTrendTopic({
      topic: 'GPT 5.6 Sol Luna Terra',
      relatedNews: [
        { source: 'OpenAI', title: 'GPT-5.6: Frontier intelligence that scales with your ambition' },
      ],
    })

    expect(result.refined).toBe(false)
    expect(result.editorialTopic).toBe('GPT 5.6 Sol Luna Terra')
  })
})
