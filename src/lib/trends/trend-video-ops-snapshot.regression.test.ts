import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/trends/trend-video-ops-snapshot.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-video-ops-snapshot', () => {
  it('monta snapshot compartilhado com config, summary, bottleneck e groups', () => {
    expect(SRC).toContain('getTrendVideoOpsObservabilityConfig')
    expect(SRC).toContain('countTrendVideoJobsSummary')
    expect(SRC).toContain('getTrendVideoCurrentBottleneck')
    expect(SRC).toContain('getTrendVideoBottleneckJobs')
    expect(SRC).toContain('groupTrendVideoJobsByOperationalStage')
    expect(SRC).toContain('getTrendVideoStageGroupSummary')
  })
})
