import { describe, expect, it } from 'vitest'
import { xBacklogCapacity } from './x-backpressure'

describe('X backlog capacity', () => {
  it('matches the Sentinel dynamic capacity contract', () => {
    expect(xBacklogCapacity(193, 72)).toBe(124)
    expect(xBacklogCapacity(0, 72)).toBe(20)
  })
})
