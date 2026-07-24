import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/cron/trend-video-publish/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-video-publish visual QA', () => {
  it('persiste quality.visual em generation_memory', () => {
    expect(SRC).toMatch(/generationMemory\.quality\s*=\s*\{/)
    expect(SRC).toMatch(/visual:\s*\{[\s\S]*checkedAt:/)
    expect(SRC).toMatch(/withOptionalTrendVideoGenerationMemory\([\s\S]*generationMemory/)
  })

  it('bloqueia publish quando visual QA falha', () => {
    expect(SRC).toMatch(/analyzeTrendVideoVisualQuality\(videoUrl\)/)
    expect(SRC).toMatch(/error_code:\s*'trend_video_visual_quality_failed'/)
    expect(SRC).toMatch(/return NextResponse\.json\([\s\S]*trend_video_visual_quality_failed/)
  })
})
