import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-video-animate/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-video-animate text-to-video puro', () => {
  it('carrega cadeia de fallback para text-to-video', () => {
    expect(SRC).toMatch(/trend_video_higgsfield_text_model_fallbacks/)
    expect(SRC).toMatch(/const textModelChain = buildModelChain/)
    expect(SRC).toMatch(/for \(const textModel of textModelChain\)/)
  })

  it('NÃO carrega mais image-to-video nem dual-frame segments', () => {
    expect(SRC).not.toMatch(/trend_video_higgsfield_model_fallbacks/)
    expect(SRC).not.toMatch(/image_to_video/)
    expect(SRC).not.toMatch(/imageModelChain/)
    expect(SRC).not.toMatch(/buildDefaultSegments/)
    expect(SRC).not.toMatch(/splitShotDuration/)
    expect(SRC).not.toMatch(/hasDualFrame/)
    expect(SRC).not.toMatch(/startImagePrompt|endImagePrompt/)
    expect(SRC).not.toMatch(/startMotionPrompt|endMotionPrompt/)
  })

  it('carrega fallback configuravel de imagem e persiste attempts (só para a capa)', () => {
    expect(SRC).toMatch(/trend_video_image_provider_chain/)
    expect(SRC).toMatch(/providerChain: imageProviderChain/)
    expect(SRC).toMatch(/attempts: generatedBaseImage\.attempts/)
    expect(SRC).not.toMatch(/attempts: imageAsset\.attempts/)
  })

  it('usa startHiggsfieldTextToVideoJob e nao startHiggsfieldImageToVideoJob', () => {
    expect(SRC).toMatch(/startHiggsfieldTextToVideoJob/)
    expect(SRC).not.toMatch(/startHiggsfieldImageToVideoJob/)
  })

  it('REGRESSAO: nunca faz image-to-video nem dual-frame', () => {
    const src = SRC
    // Verifica que as funcoes/imports de image-to-video foram removidas
    expect(src).not.toMatch(/startHiggsfieldImageToVideoJob/)
    expect(src).not.toMatch(/HiggsfieldStartInput/)
    expect(src).not.toMatch(/normalizeDoPModel/)
    expect(src).not.toMatch(/image_to_video/)
    // Verifica que dual-frame segments não existem
    expect(src).not.toMatch(/TrendShotSegmentResult/)
    expect(src).not.toMatch(/segmentId/)
    expect(src).not.toMatch(/buildDefaultSegments/)
    expect(src).not.toMatch(/splitShotDuration/)
    expect(src).not.toMatch(/hasDualFrame/)
  })
})
