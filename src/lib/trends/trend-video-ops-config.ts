import type { TrendVideoOpsSummary } from '@/lib/trends/trend-video-ops-summary'
import { getTrendVideoQualityObservabilityConfig, type TrendVideoQualityObservabilityConfig } from '@/lib/trends/trend-video-quality-config'

export type TrendVideoBottleneckKey = 'animate' | 'publish' | 'metrics' | 'failed' | 'none'
export type TrendVideoOperationalStage = 'planejado' | 'imagem' | 'capa' | 'render' | 'publicar' | 'metricas' | 'erro'

export interface TrendVideoBottleneckCopy {
  key: TrendVideoBottleneckKey
  label: string
  detail: string
  action: string
}

export interface TrendVideoOpsObservabilityConfig {
  animateStatuses: readonly string[]
  bottleneckMaxJobs: number
  metricsWindowDays: number
  severityThresholds: {
    medium: number
    high: number
  }
  quality: TrendVideoQualityObservabilityConfig
}

export const TREND_VIDEO_ANIMATE_STATUSES = ['creative_ready', 'image_ready', 'cover_ready', 'rendering'] as const
export const TREND_VIDEO_BOTTLENECK_MAX_JOBS = 3
export const TREND_VIDEO_METRICS_WINDOW_DAYS = 14
export const TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS = {
  medium: 3,
  high: 8,
} as const

export const TREND_VIDEO_STATUS_STAGE: Record<string, TrendVideoOperationalStage> = {
  creative_ready: 'planejado',
  image_ready: 'imagem',
  cover_ready: 'capa',
  rendering: 'render',
  ready: 'publicar',
  published: 'metricas',
  failed: 'erro',
}

export const TREND_VIDEO_STAGE_PRIORITY: Record<TrendVideoOperationalStage, number> = {
  erro: 0,
  publicar: 1,
  render: 2,
  capa: 3,
  imagem: 4,
  planejado: 5,
  metricas: 6,
}

export const TREND_VIDEO_BOTTLENECK_COPY: Record<TrendVideoBottleneckKey, TrendVideoBottleneckCopy> = {
  animate: {
    key: 'animate',
    label: 'Animacao',
    detail: 'jobs parados antes do video final',
    action: 'Verificar fila de render e modelos de video.',
  },
  publish: {
    key: 'publish',
    label: 'Publicacao',
    detail: 'jobs prontos aguardando carrossel',
    action: 'Conferir CTA, capa e liberar publish.',
  },
  metrics: {
    key: 'metrics',
    label: 'Metricas',
    detail: 'posts publicados aguardando sync',
    action: 'Rodar sync de insights e giveaway funnel.',
  },
  failed: {
    key: 'failed',
    label: 'Falhas',
    detail: 'jobs quebrados exigindo intervencao',
    action: 'Inspecionar erros e reprocessar os jobs falhos.',
  },
  none: {
    key: 'none',
    label: 'Sem gargalo',
    detail: 'nenhum acumulo detectado',
    action: 'Fluxo saudavel. Monitorar proximos ciclos.',
  },
}

export function getTrendVideoBottleneckCandidates(summary: TrendVideoOpsSummary): Array<TrendVideoBottleneckCopy & { count: number }> {
  return [
    { ...TREND_VIDEO_BOTTLENECK_COPY.animate, count: summary.animateEligible },
    { ...TREND_VIDEO_BOTTLENECK_COPY.publish, count: summary.publishEligible },
    { ...TREND_VIDEO_BOTTLENECK_COPY.metrics, count: summary.metricsEligible },
    { ...TREND_VIDEO_BOTTLENECK_COPY.failed, count: summary.failed },
  ]
}

export function getTrendVideoOpsObservabilityConfig(): TrendVideoOpsObservabilityConfig {
  return {
    animateStatuses: TREND_VIDEO_ANIMATE_STATUSES,
    bottleneckMaxJobs: TREND_VIDEO_BOTTLENECK_MAX_JOBS,
    metricsWindowDays: TREND_VIDEO_METRICS_WINDOW_DAYS,
    severityThresholds: {
      medium: TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS.medium,
      high: TREND_VIDEO_BOTTLENECK_SEVERITY_THRESHOLDS.high,
    },
    quality: getTrendVideoQualityObservabilityConfig(),
  }
}
