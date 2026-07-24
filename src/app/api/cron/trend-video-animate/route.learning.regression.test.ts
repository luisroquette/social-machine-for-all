import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-video-animate/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-video-animate text-to-video puro', () => {
  it('não carrega mais imageModelChain / image_to_video / segments dual-frame', () => {
    expect(SRC).not.toMatch(/imageModelChain/)
    expect(SRC).not.toMatch(/image_to_video/)
    expect(SRC).not.toMatch(/startImageUrl/)
    expect(SRC).not.toMatch(/endImagePrompt/)
    expect(SRC).not.toMatch(/buildDefaultSegments/)
    expect(SRC).not.toMatch(/hasDualFrame/)
  })

  it('usa apenas text-to-video chain (seedance-2.0) e textModelChain', () => {
    expect(SRC).toMatch(/textModelChain/)
    expect(SRC).toMatch(/buildModelChain/)
    expect(SRC).toMatch(/startHiggsfieldTextToVideoJob/)
    expect(SRC).not.toMatch(/startHiggsfieldImageToVideoJob/)
  })

  it('usa provider_model salvo no job como primario para text-to-video', () => {
    expect(SRC).toMatch(/providerModel = typeof job\.provider_model === 'string'/)
    expect(SRC).toMatch(/const jobSelect: string = hasGenerationMemory/)
    expect(SRC).toMatch(/generation_memory, provider_model, video_provider/)
    expect(SRC).toMatch(/\.select\(jobSelect\)/)
  })

  it('não usa mais generationMode / learnedGenerationMode (image-to-video removido)', () => {
    expect(SRC).not.toMatch(/preferredGenerationMode/)
    expect(SRC).not.toMatch(/generationMode/)
    expect(SRC).not.toMatch(/learnedGenerationMode/)
    expect(SRC).not.toMatch(/normalizeGenerationMode/)
  })

  it('usa shot_results simplificado (sem segments, sem imagePrompt/startImagePrompt/endImagePrompt)', () => {
    expect(SRC).not.toMatch(/segment/)
    expect(SRC).not.toMatch(/startImagePrompt/)
    expect(SRC).not.toMatch(/endImagePrompt/)
    expect(SRC).not.toMatch(/startMotionPrompt/)
    expect(SRC).not.toMatch(/endMotionPrompt/)
    expect(SRC).not.toMatch(/TrendShotSegmentResult/)
  })

  it('conta concorrência por shots (não segments) e simplifica retry', () => {
    expect(SRC).toMatch(/countActiveRenderingShots/)
    expect(SRC).toMatch(/canRetryShot/)
    expect(SRC).not.toMatch(/canRetrySegment/)
  })
})
