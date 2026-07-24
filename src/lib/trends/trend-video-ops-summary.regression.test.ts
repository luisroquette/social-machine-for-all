import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/lib/trends/trend-video-ops-summary.ts'),
  'utf-8',
)

describe('REGRESSÃO: trend-video-ops-summary config central', () => {
  it('usa config central para status, estagios e prioridade', () => {
    expect(SRC).toContain("from '@/lib/trends/trend-video-ops-config'")
    expect(SRC).toContain('TREND_VIDEO_ANIMATE_STATUSES')
    expect(SRC).toContain('TREND_VIDEO_BOTTLENECK_MAX_JOBS')
    expect(SRC).toContain('TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS')
    expect(SRC).toContain('TREND_VIDEO_STATUS_STAGE')
    expect(SRC).toContain('TREND_VIDEO_STAGE_PRIORITY')
  })

  it('nao redefine thresholds e prioridade inline no helper', () => {
    expect(SRC).not.toContain('const priority: Record<string, number> = {')
    expect(SRC).not.toContain("if (job.status === 'creative_ready') return 'planejado'")
    expect(SRC).not.toContain('.slice(0, 3)')
    expect(SRC).not.toContain("top.count >= 8 ? 'high' : top.count >= 3 ? 'medium' : 'low'")
  })
})
