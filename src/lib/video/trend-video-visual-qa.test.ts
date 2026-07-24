import { describe, expect, it } from 'vitest'
import { scoreVisualFrameDeltas } from './trend-video-visual-qa'

function makeFrame(value: number) {
  return Buffer.alloc(32 * 32 * 3, value)
}

describe('trend-video-visual-qa', () => {
  it('bloqueia video com frames quase identicos', () => {
    const frames = [makeFrame(10), makeFrame(10), makeFrame(11), makeFrame(11)]
    const result = scoreVisualFrameDeltas(frames)

    expect(result.passed).toBe(false)
    expect(result.criticalIssues).toContainEqual(expect.stringContaining('visual_photo_loop_risk'))
    expect(result.metrics.motionScore).toBeLessThan(3)
  })

  it('aprova video com variacao visual real', () => {
    const frames = [makeFrame(10), makeFrame(30), makeFrame(80), makeFrame(140)]
    const result = scoreVisualFrameDeltas(frames)

    expect(result.passed).toBe(true)
    expect(result.criticalIssues).toHaveLength(0)
    expect(result.metrics.avgFrameDelta).toBeGreaterThan(2.5)
    expect(result.metrics.motionScore).toBeGreaterThan(4)
  })
})
