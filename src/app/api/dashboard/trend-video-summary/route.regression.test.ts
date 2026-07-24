import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/api/dashboard/trend-video-summary/route.ts'),
  'utf-8',
)

describe('REGRESSÃO: api/dashboard/trend-video-summary', () => {
  it('exige auth e workspaceId', () => {
    expect(SRC).toContain('Bearer ${process.env.CRON_SECRET}')
    expect(SRC).toContain("workspaceId required")
  })

  it('retorna resumo operacional e gargalo', () => {
    expect(SRC).toContain('buildTrendVideoOpsSnapshot')
    expect(SRC).toContain('const snapshot = buildTrendVideoOpsSnapshot(jobs)')
    expect(SRC).toContain('config: snapshot.config')
    expect(SRC).toContain('summary: snapshot.summary')
    expect(SRC).toContain('bottleneck: snapshot.bottleneck')
  })

  it('compartilha a linguagem operacional do helper central', () => {
    expect(SRC).toContain("from '@/lib/trends/trend-video-ops-snapshot'")
  })

  it('retorna grupos e jobs com assets operacionais', () => {
    expect(SRC).toContain('snapshot.groups.map((group) => ({')
    expect(SRC).toContain('summary: group.summary')
    expect(SRC).toContain('videoUrl: job.video_url')
    expect(SRC).toContain('coverUrl: job.cover_url')
    expect(SRC).toContain('baseImageUrl: job.base_image_url')
  })
})
