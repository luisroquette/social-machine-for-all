import { getTrendVideoOpsObservabilityConfig } from '@/lib/trends/trend-video-ops-config'
import {
  countTrendVideoJobsSummary,
  getTrendVideoBottleneckJobs,
  getTrendVideoCurrentBottleneck,
  getTrendVideoStageGroupSummary,
  groupTrendVideoJobsByOperationalStage,
  type TrendVideoOpsJobLike,
} from '@/lib/trends/trend-video-ops-summary'

export function buildTrendVideoOpsSnapshot(jobs: TrendVideoOpsJobLike[]) {
  const summary = countTrendVideoJobsSummary(jobs)
  const bottleneck = getTrendVideoCurrentBottleneck(summary)
  const bottleneckJobs = getTrendVideoBottleneckJobs(jobs, bottleneck.label)
  const groups = groupTrendVideoJobsByOperationalStage(bottleneckJobs)

  return {
    config: getTrendVideoOpsObservabilityConfig(),
    summary,
    bottleneck,
    bottleneckJobs,
    groups: groups.map((group) => ({
      stage: group.stage,
      summary: getTrendVideoStageGroupSummary(group.jobs),
      jobs: group.jobs,
    })),
  }
}
