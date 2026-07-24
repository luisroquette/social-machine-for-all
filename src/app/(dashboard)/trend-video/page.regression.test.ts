import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/trend-video/page.tsx'),
  'utf-8',
)
const LAYOUT = readFileSync(
  join(process.cwd(), 'src/app/(dashboard)/layout.tsx'),
  'utf-8',
)

describe('REGRESSÃO: Trend Video dashboard operacional', () => {
  it('le trend_video_jobs, br_trend_topics e trend_style_stats', () => {
    expect(SRC).toContain("from('trend_video_jobs')")
    expect(SRC).toContain("from('br_trend_topics')")
    expect(SRC).toContain("from('trend_style_stats')")
  })

  it('exibe progresso de shots, assets e giveaway analytics', () => {
    expect(SRC).toContain('getShotProgress')
    expect(SRC).toContain('getImageProviderSummary')
    expect(SRC).toContain('promptRequests')
    expect(SRC).toContain('deliveryRate')
  })

  it('exibe score base versus learned do topic', () => {
    expect(SRC).toContain('getTopicScores')
    expect(SRC).toContain("select('id, topic, category, source, trend_score, safety_status, raw_payload')")
    expect(SRC).toContain('score {scores.base} -&gt; {scores.learned}')
  })

  it('exibe resumo operacional de elegibilidade', () => {
    expect(SRC).toContain('animateEligibleRaw')
    expect(SRC).toContain('publishEligibleRaw')
    expect(SRC).toContain('metricsEligibleRaw')
    expect(SRC).toContain('Animate Eligible')
    expect(SRC).toContain('Publish Eligible')
    expect(SRC).toContain('Metrics Eligible')
    expect(SRC).toContain('buildTrendVideoOpsSnapshot')
    expect(SRC).toContain('Regras Ativas')
    expect(SRC).toContain('opsConfig.animateStatuses.join')
    expect(SRC).toContain('opsConfig.bottleneckMaxJobs')
    expect(SRC).toContain('opsConfig.metricsWindowDays')
    expect(SRC).toContain('opsConfig.severityThresholds.medium')
    expect(SRC).toContain('opsConfig.severityThresholds.high')
    expect(SRC).toContain('opsConfig.quality.staticGate.passScore')
    expect(SRC).toContain('opsConfig.quality.visualQa.minMotionScore')
  })

  it('exibe gargalo atual calculado automaticamente', () => {
    expect(SRC).toContain('Gargalo Atual')
    expect(SRC).toContain('currentBottleneck.label')
    expect(SRC).toContain('currentBottleneck.detail')
    expect(SRC).toContain('currentBottleneck.severity')
    expect(SRC).toContain('Acao sugerida: {currentBottleneck.action}')
    expect(SRC).toContain('Jobs impactados')
    expect(SRC).toContain('bottleneckJobGroups.map((group) => (')
    expect(SRC).toContain('job.video_url')
    expect(SRC).toContain('job.cover_url')
    expect(SRC).toContain('job.base_image_url')
    expect(SRC).toContain("from('generated_content')")
    expect(SRC).toContain('published?.published_url')
    expect(SRC).toContain("from '@/lib/trends/trend-video-ops-snapshot'")
    expect(SRC).toContain('const opsSnapshot = buildTrendVideoOpsSnapshot(jobs)')
    expect(SRC).toContain('getTrendVideoOperationalStage')
    expect(SRC).not.toContain('getTrendVideoStageGroupSummary')
    expect(SRC).toContain('bottleneckJobGroups.map((group) => (')
    expect(SRC).toContain("group.stage === bottleneckJobGroups[0]?.stage")
    expect(SRC).toContain("border border-orange-300 bg-orange-50/60 p-3")
    expect(SRC).toContain('{summary.total} jobs')
    expect(SRC).toContain('{summary.withError} com erro')
    expect(SRC).toContain('{summary.withReadyAsset} com asset pronto')
    expect(SRC).toContain('{summary.publishableNow} publicavel agora')
    expect(SRC).toContain('{group.jobs.length} item(ns)')
    expect(SRC).toContain('<Badge variant="outline">{stage}</Badge>')
    expect(SRC).toContain('job {job.id.slice(0, 8)}')
  })

  it('esta linkado no nav principal do dashboard', () => {
    expect(LAYOUT).toContain('href="/trend-video"')
    expect(LAYOUT).toContain('Trend Video')
  })
})
