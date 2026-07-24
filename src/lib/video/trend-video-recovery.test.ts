import { describe, expect, it } from 'vitest'
import { recoverTrendVideoSegments } from './trend-video-recovery'

describe('recoverTrendVideoSegments', () => {
  it('recupera um segmento ausente usando o segmento irmao', () => {
    const result = recoverTrendVideoSegments([
      {
        segments: [
          { clipUrl: 'https://example.com/a.mp4', durationSec: 1.2 },
          { clipUrl: null, durationSec: 1.3 },
        ],
      },
      {
        segments: [
          { clipUrl: 'https://example.com/b.mp4', durationSec: 1.4 },
          { clipUrl: 'https://example.com/c.mp4', durationSec: 1.5 },
        ],
      },
    ])

    expect(result.recoverable).toBe(true)
    expect(result.recoveredMissingSegments).toBe(1)
    expect(result.segments[1]?.clipUrl).toBe('https://example.com/a.mp4')
  })

  it('nao tenta recuperar quando faltam dois segmentos', () => {
    const result = recoverTrendVideoSegments([
      {
        segments: [
          { clipUrl: null, durationSec: 1.2 },
          { clipUrl: null, durationSec: 1.3 },
        ],
      },
    ])

    expect(result.recoverable).toBe(false)
    expect(result.recoveredMissingSegments).toBe(0)
  })
})
