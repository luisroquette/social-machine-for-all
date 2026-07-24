import {
  getTrendVideoBottleneckCandidates,
  TREND_VIDEO_ANIMATE_STATUSES,
  TREND_VIDEO_BOTTLENECK_MAX_JOBS,
  TREND_VIDEO_BOTTLENECK_COPY,
  TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS,
  TREND_VIDEO_STAGE_PRIORITY,
  TREND_VIDEO_STATUS_STAGE,
  type TrendVideoOperationalStage,
} from '@/lib/trends/trend-video-ops-config'

export type TrendVideoOpsJobStatus = 'creative_ready' | 'image_ready' | 'cover_ready' | 'rendering' | 'ready' | 'published' | 'failed'

export interface TrendVideoOpsJobLike {
  id: string
  status: TrendVideoOpsJobStatus
  cover_title: string
  provider_model: string | null
  base_image_url: string | null
  cover_url: string | null
  video_url: string | null
  error_code: string | null
  published_generated_content_id: string | null
  updated_at: string
}

export interface TrendVideoOpsSummary {
  animateEligible: number
  publishEligible: number
  metricsEligible: number
  failed: number
}

export interface TrendVideoOpsBottleneck {
  label: string
  count: number
  detail: string
  severity: 'low' | 'medium' | 'high'
  action: string
}

export interface TrendVideoStageGroupSummary {
  total: number
  withError: number
  withReadyAsset: number
  publishableNow: number
}

export function countTrendVideoJobsSummary(jobs: TrendVideoOpsJobLike[]): TrendVideoOpsSummary {
  return {
    animateEligible: jobs.filter((job) => TREND_VIDEO_ANIMATE_STATUSES.includes(job.status as typeof TREND_VIDEO_ANIMATE_STATUSES[number])).length,
    publishEligible: jobs.filter((job) => job.status === 'ready').length,
    metricsEligible: jobs.filter((job) => job.status === 'published' && Boolean(job.published_generated_content_id)).length,
    failed: jobs.filter((job) => job.status === 'failed').length,
  }
}

export function getTrendVideoOperationalStage(job: TrendVideoOpsJobLike): TrendVideoOperationalStage | TrendVideoOpsJobStatus {
  return TREND_VIDEO_STATUS_STAGE[job.status] ?? job.status
}

export function getTrendVideoCurrentBottleneck(counts: TrendVideoOpsSummary): TrendVideoOpsBottleneck {
  const candidates = getTrendVideoBottleneckCandidates(counts)
    .sort((a, b) => b.count - a.count)

  const top = candidates[0]
  if (!top) {
    return { ...TREND_VIDEO_BOTTLENECK_COPY.none, count: 0, severity: 'low' }
  }

  return {
    ...top,
    severity: top.count >= TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS.high
      ? 'high'
      : top.count >= TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS.medium
        ? 'medium'
        : 'low',
  }
}

export function getTrendVideoBottleneckJobs(jobs: TrendVideoOpsJobLike[], bottleneckLabel: string): TrendVideoOpsJobLike[] {
  const candidates = bottleneckLabel === 'Animacao'
    ? jobs.filter((job) => TREND_VIDEO_ANIMATE_STATUSES.includes(job.status as typeof TREND_VIDEO_ANIMATE_STATUSES[number]))
    : bottleneckLabel === 'Publicacao'
      ? jobs.filter((job) => job.status === 'ready')
      : bottleneckLabel === 'Metricas'
        ? jobs.filter((job) => job.status === 'published' && Boolean(job.published_generated_content_id))
        : jobs.filter((job) => job.status === 'failed')

  return candidates
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, TREND_VIDEO_BOTTLENECK_MAX_JOBS)
}

export function groupTrendVideoJobsByOperationalStage(jobs: TrendVideoOpsJobLike[]): Array<{
  stage: string
  jobs: TrendVideoOpsJobLike[]
}> {
  const groups = new Map<string, TrendVideoOpsJobLike[]>()

  for (const job of jobs) {
    const stage = getTrendVideoOperationalStage(job)
    const current = groups.get(stage) ?? []
    current.push(job)
    groups.set(stage, current)
  }

  return Array.from(groups.entries())
    .map(([stage, groupedJobs]) => ({ stage, jobs: groupedJobs }))
    .sort((a, b) => {
      const priorityA = TREND_VIDEO_STAGE_PRIORITY[a.stage as TrendVideoOperationalStage] ?? 999
      const priorityB = TREND_VIDEO_STAGE_PRIORITY[b.stage as TrendVideoOperationalStage] ?? 999
      if (priorityA !== priorityB) return priorityA - priorityB
      return b.jobs.length - a.jobs.length
    })
}

export function getTrendVideoStageGroupSummary(jobs: TrendVideoOpsJobLike[]): TrendVideoStageGroupSummary {
  return {
    total: jobs.length,
    withError: jobs.filter((job) => Boolean(job.error_code)).length,
    withReadyAsset: jobs.filter((job) => Boolean(job.video_url || job.cover_url || job.base_image_url)).length,
    publishableNow: jobs.filter((job) => Boolean(job.video_url) && Boolean(job.cover_url || job.base_image_url)).length,
  }
}
