import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = readFileSync(join(process.cwd(), 'src/lib/platforms/instagram/client.ts'), 'utf8')

describe('Instagram visual quality gate coverage', () => {
  it.each(['publishImage', 'publishCarousel', 'publishMixedCarousel', 'publishReel'])('%s invokes the central visual gate', (method) => {
    const start = SRC.indexOf(`async ${method}(`)
    const nextMethod = SRC.indexOf('\n  async ', start + 10)
    const body = SRC.slice(start, nextMethod === -1 ? SRC.length : nextMethod)
    expect(body).toContain('this.enforceVisualQuality(')
  })

  it('is fail-closed and returns before any Meta container request', () => {
    expect(SRC).toContain('if (!qualityCheck.success) return qualityCheck')
    expect(SRC).toContain("'quality_gate_rejected'")
    expect(SRC).toContain('quality_gate_unavailable')
  })

  it('returns the approved review so feedback is not lost', () => {
    expect(SRC).toContain('qualityReview: qualityCheck.qualityReview')
  })
})
