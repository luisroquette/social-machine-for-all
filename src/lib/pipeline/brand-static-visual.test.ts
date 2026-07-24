import { describe, expect, it } from 'vitest'
import { applyMultimodalJudgment, scoreStaticImageAnalysis } from './brand-static-visual'

describe('brand static visual', () => {
  it('multimodal premia hero shot com veiculo presente', () => {
    const base = scoreStaticImageAnalysis({
      url: 'https://cdn.example.com/byd-seal.jpg',
      width: 1600,
      height: 1000,
      edgeDensity: 0.14,
      ocrText: '',
    })

    const boosted = applyMultimodalJudgment(base, {
      vehicle_present: true,
      text_heavy: false,
      watermark: false,
      hero_shot: true,
      ui_screenshot: false,
      confidence: 0.94,
      reason: 'clean exterior vehicle hero shot',
    })

    expect(boosted.score).toBeGreaterThan(base.score)
    expect(boosted.heroShotScore).toBeGreaterThan(base.heroShotScore)
    expect(boosted.reasons).toContain('mm_vehicle_present')
    expect(boosted.reasons).toContain('mm_hero_shot')
  })

  it('multimodal derruba screenshot com watermark e ui', () => {
    const base = scoreStaticImageAnalysis({
      url: 'https://cdn.example.com/post.jpg',
      width: 1080,
      height: 1920,
      edgeDensity: 0.21,
      ocrText: 'seguir posts byd chega ao brasil',
    })

    const downgraded = applyMultimodalJudgment(base, {
      vehicle_present: true,
      text_heavy: true,
      watermark: true,
      hero_shot: false,
      ui_screenshot: true,
      confidence: 0.91,
      reason: 'instagram screenshot with visible ui and overlay text',
    })

    expect(downgraded.score).toBeLessThan(base.score)
    expect(downgraded.watermarkScore).toBeGreaterThan(base.watermarkScore)
    expect(downgraded.screenshotScore).toBeGreaterThan(base.screenshotScore)
    expect(downgraded.reasons).toContain('mm_ui_screenshot')
    expect(downgraded.reasons).toContain('mm_watermark')
  })
})
