import { describe, expect, it } from 'vitest'
import {
  applyLearnedStyleRotation,
  buildTrendLearningPack,
  classifyTrendVideoModelMode,
  scoreAdaptiveTrendTopic,
  scoreTrendLearningPreference,
  scoreTrendVideoLearningPreference,
} from './trend-learning'

describe('trend learning', () => {
  it('prioriza combinacao com melhor performance historica', () => {
    const result = scoreTrendLearningPreference({
      style: 'anime-stadium',
      hook_pattern: 'ninguem esperava isso',
      topic_category: 'sports',
      posts_count: 4,
      avg_reach: 32000,
      avg_likes: 2200,
      avg_saves: 600,
      avg_shares: 450,
      avg_prompt_requests: 18,
      delivery_rate: 41,
    })

    expect(result.score).toBeGreaterThan(3)
    expect(result.reasons).toContain('reach_forte')
    expect(result.reasons).toContain('prompt_forte')
  })

  it('monta pack de preferencia por categoria', () => {
    const pack = buildTrendLearningPack([
      {
        style: 'anime-stadium',
        hook_pattern: 'ninguem esperava isso',
        topic_category: 'sports',
        posts_count: 4,
        avg_reach: 32000,
        avg_likes: 2200,
        avg_saves: 600,
        avg_shares: 450,
        avg_prompt_requests: 18,
        delivery_rate: 41,
      },
      {
        style: 'ultrarealista',
        hook_pattern: 'o que esta por tras',
        topic_category: 'sports',
        posts_count: 2,
        avg_reach: 12000,
        avg_likes: 800,
        avg_saves: 120,
        avg_shares: 90,
        avg_prompt_requests: 4,
        delivery_rate: 12,
      },
      {
        style: 'futurista-neon',
        hook_pattern: 'a revelacao que acelerou',
        topic_category: 'technology',
        posts_count: 3,
        avg_reach: 50000,
        avg_likes: 5000,
        avg_saves: 1000,
        avg_shares: 900,
        avg_prompt_requests: 30,
        delivery_rate: 55,
      },
    ], [
      {
        topicCategory: 'sports',
        editorialTemplateId: 'futebol_absurdo',
        editorialTemplateLabel: 'Futebol absurdo',
        videoProvider: 'higgsfield',
        providerModel: 'seedance-2.0',
        generationMode: 'prompt_video',
        reach: 45000,
        likes: 3000,
        saves: 700,
        shares: 500,
        promptRequests: 20,
        deliveryRate: 40,
      },
    ], 'sports')

    expect(pack.preferredStyle).toBe('anime-stadium')
    expect(pack.preferredHookPattern).toBe('ninguem esperava isso')
    expect(pack.topStyles[0]).toBe('anime-stadium')
    expect(pack.preferredEditorialTemplateId).toBe('futebol_absurdo')
    expect(pack.preferredVideoModel).toBe('seedance-2.0')
    expect(pack.preferredGenerationMode).toBe('prompt_video')
  })

  it('injeta estilos aprendidos na frente da rotacao', () => {
    const merged = applyLearnedStyleRotation(['ultrarealista', 'anime-stadium'], ['editorial-premium', 'ultrarealista'])
    expect(merged).toEqual(['editorial-premium', 'ultrarealista', 'anime-stadium'])
  })

  it('classifica modo de geracao pelo modelo', () => {
    expect(classifyTrendVideoModelMode('seedance-2.0')).toBe('prompt_video')
    expect(classifyTrendVideoModelMode('dop-preview')).toBe('image_to_video')
  })

  it('pontua preferencia de template e modelo de video', () => {
    const result = scoreTrendVideoLearningPreference({
      topicCategory: 'sports',
      editorialTemplateId: 'futebol_absurdo',
      editorialTemplateLabel: 'Futebol absurdo',
      videoProvider: 'higgsfield',
      providerModel: 'seedance-2.0',
      generationMode: 'prompt_video',
      reach: 45000,
      likes: 3000,
      saves: 700,
      shares: 500,
      promptRequests: 20,
      deliveryRate: 40,
    })

    expect(result.editorialTemplateId).toBe('futebol_absurdo')
    expect(result.providerModel).toBe('seedance-2.0')
    expect(result.generationMode).toBe('prompt_video')
    expect(result.score).toBeGreaterThan(3)
  })

  it('aumenta score de topic com forte aderencia historica', () => {
    const pack = buildTrendLearningPack([
      {
        style: 'anime-stadium',
        hook_pattern: 'ninguem esperava isso',
        topic_category: 'sports',
        posts_count: 4,
        avg_reach: 32000,
        avg_likes: 2200,
        avg_saves: 600,
        avg_shares: 450,
        avg_prompt_requests: 18,
        delivery_rate: 41,
      },
    ], [
      {
        topicCategory: 'sports',
        editorialTemplateId: 'futebol_absurdo',
        editorialTemplateLabel: 'Futebol absurdo',
        videoProvider: 'higgsfield',
        providerModel: 'seedance-2.0',
        generationMode: 'prompt_video',
        reach: 45000,
        likes: 3000,
        saves: 700,
        shares: 500,
        promptRequests: 20,
        deliveryRate: 40,
      },
    ], 'sports')

    const boosted = scoreAdaptiveTrendTopic({
      topic: 'Gol historico na final',
      category: 'sports',
      relatedText: 'torcida em choque no estadio',
      baseTrendScore: 72,
      visualPotential: 16,
      emotionalPotential: 12,
      shortViralFit: 13,
      learning: pack,
    })

    expect(boosted).toBeGreaterThan(72)
  })
})
