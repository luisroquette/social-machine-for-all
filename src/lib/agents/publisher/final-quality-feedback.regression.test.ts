import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const PUBLISHER = readFileSync(join(process.cwd(), 'src/lib/agents/publisher/index.ts'), 'utf8')
const MARKETING = readFileSync(join(process.cwd(), 'src/lib/pipeline/brand-marketing-assets.ts'), 'utf8')
const TREND = readFileSync(join(process.cwd(), 'src/app/api/cron/trend-video-publish/route.ts'), 'utf8')

describe('final quality feedback persistence', () => {
  it('publisher records final quality rejection without retry', () => {
    expect(PUBLISHER).toContain("if (result.qualityReview?.outcome === 'rejected')")
    expect(PUBLISHER).toContain("status: 'rejected'")
    expect(PUBLISHER).toContain('final_quality_review: result.qualityReview')
  })

  it('publisher preserves visual feedback for approved posts', () => {
    expect(PUBLISHER).toContain('publishedMetadata')
    expect(PUBLISHER).toContain('final_quality_review: result.qualityReview')
  })

  it('marketing asset rejection is persisted and quarantined', () => {
    expect(MARKETING).toContain("const qualityRejected = result.qualityReview?.outcome === 'rejected'")
    expect(MARKETING).toContain("status: qualityRejected ? 'rejected' : 'failed'")
    expect(MARKETING).toContain('if (qualityRejected)')
    expect(MARKETING).toContain("update({ used_at: new Date().toISOString() })")
  })

  it('trend-video distinguishes quality rejection from API failure', () => {
    expect(TREND).toContain("'quality_gate_rejected'")
    expect(TREND).toContain("'quality_gate_unavailable'")
    expect(TREND).toContain('final_quality_review: result.qualityReview')
  })

  it('trend-video keeps unavailable reviews retryable', () => {
    expect(TREND).toContain("const qualityUnavailable = result.qualityReview?.outcome === 'unavailable'")
    expect(TREND).toContain("status: qualityUnavailable ? 'ready' : 'failed'")
  })
})
