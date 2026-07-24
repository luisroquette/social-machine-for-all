import { describe, expect, it } from 'vitest'
import { runTrendVideoQualityGate } from './trend-video-quality'

describe('trend video quality gate', () => {
  it('aprova um pacote com diversidade, duracao e cover validos', () => {
    const result = runTrendVideoQualityGate({
      topic: 'Jorge Jesus em Portugal',
      category: 'sports',
      hookTitle: 'JORGE JESUS MUDA O JOGO EM PORTUGAL',
      coverTitle: 'JORGE JESUS ASSUME PORTUGAL: A REVOLUCAO TATICA',
      caption: 'Legenda longa o bastante para passar no gate com CTA forte e contexto suficiente para um post viral no Instagram.',
      coverUrl: 'https://example.com/cover.png',
      generationMemory: {
        coverBaseImage: { url: 'https://example.com/base.png' },
      },
      shotResults: [
        { visualStyle: 'ultrarealista', visualIntent: 'entrada brutal', motionPrompt: 'impacto real', segments: [{ durationSec: 2.5, motionPrompt: 'impacto real' }] },
        { visualStyle: 'anime', visualIntent: 'virada estilizada', motionPrompt: 'orbita explosiva', segments: [{ durationSec: 2.5, motionPrompt: 'orbita explosiva' }] },
        { visualStyle: 'abstrato-graphic', visualIntent: 'dados colidem', motionPrompt: 'fragmentos e dados colidem', segments: [{ durationSec: 2.5, motionPrompt: 'fragmentos e dados colidem' }] },
        { visualStyle: 'cinematic-reveal', visualIntent: 'reveal heroico', motionPrompt: 'crane reveal heroico', segments: [{ durationSec: 2.5, motionPrompt: 'crane reveal heroico' }] },
      ],
    })

    expect(result.passed).toBe(true)
    expect(result.metrics.totalDurationSec).toBe(10)
  })

  it('bloqueia pacote com tema sensivel, pouca mudanca e risco de foto mexendo', () => {
    const result = runTrendVideoQualityGate({
      topic: 'Morreu cantor famoso',
      category: 'entertainment',
      hookTitle: 'POR QUE ISSO ESTA BOMBANDO',
      coverTitle: 'TREND',
      caption: 'Legenda curta.',
      shotResults: [
        { visualStyle: 'ultrarealista', visualIntent: 'mesma cena', motionPrompt: 'subtle motion only', segments: [{ durationSec: 2, motionPrompt: 'subtle motion only' }] },
        { visualStyle: 'ultrarealista', visualIntent: 'mesma cena', motionPrompt: 'subtle motion only', segments: [{ durationSec: 2, motionPrompt: 'subtle motion only' }] },
      ],
    })

    expect(result.passed).toBe(false)
    expect(result.criticalIssues.some((issue) => issue.startsWith('safety_blocked'))).toBe(true)
    expect(result.criticalIssues.some((issue) => issue.startsWith('photo_loop_risk'))).toBe(true)
    expect(result.issues).toContain('weak_cover_title')
  })
})
