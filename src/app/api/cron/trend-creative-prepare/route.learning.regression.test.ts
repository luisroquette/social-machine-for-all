import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-creative-prepare/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-creative-prepare learning', () => {
  it('carrega trend_style_stats e monta learning pack por categoria', () => {
    expect(SRC).toContain("from('trend_style_stats')")
    expect(SRC).toMatch(/buildTrendLearningPack\(/)
  })

  it('usa estilos aprendidos para influenciar a rotacao criativa', () => {
    expect(SRC).toMatch(/applyLearnedStyleRotation\(styleRotation, learning\.topStyles\)/)
    expect(SRC).toMatch(/preferredStyle: learning\.preferredStyle/)
    expect(SRC).toMatch(/preferredHookPattern: learning\.preferredHookPattern/)
  })

  it('usa template e video learning para orientar o job', () => {
    expect(SRC).toMatch(/preferredEditorialTemplateId: learning\.preferredEditorialTemplateId/)
    expect(SRC).toMatch(/preferredVideoModel: learning\.preferredVideoModel/)
    expect(SRC).toMatch(/preferredGenerationMode: learning\.preferredGenerationMode/)
    expect(SRC).toMatch(/video_provider: learning\.preferredVideoProvider \|\| 'higgsfield'/)
    expect(SRC).toMatch(/provider_model: learning\.preferredVideoModel \|\| null/)
  })

  it('persiste o contexto de learning no generation_memory', () => {
    expect(SRC).toMatch(/learning,/)
    expect(SRC).toMatch(/learningDecision:/)
    expect(SRC).toMatch(/topVideoPreferences: learning\.topVideoPreferences/)
  })

  it('reordena topics usando adaptiveTrendScore antes de criar jobs', () => {
    expect(SRC).toMatch(/adaptiveTrendScore: scoreAdaptiveTrendTopic\(/)
    expect(SRC).toMatch(/\.sort\(\(a, b\) => b\.adaptiveTrendScore - a\.adaptiveTrendScore\)/)
    expect(SRC).toMatch(/baseTrendScore: toNumber\(topic\.trend_score\)/)
  })
})
