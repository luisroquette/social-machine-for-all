export const DEFAULT_INSTAGRAM_MEDIA_INSIGHT_METRIC_SETS = [
  ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'views'],
  ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'total_views'],
  ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'impressions'],
  ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
] as const

export interface InstagramMediaInsightsResult {
  metrics: Record<string, number>
  raw: unknown
  usedMetricSet: string[]
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export async function fetchInstagramMediaInsights(params: {
  apiBase: string
  mediaId: string
  accessToken: string
  metricSets?: ReadonlyArray<ReadonlyArray<string>>
}): Promise<InstagramMediaInsightsResult> {
  const metricSets = params.metricSets ?? DEFAULT_INSTAGRAM_MEDIA_INSIGHT_METRIC_SETS
  let lastError = 'instagram_media_insights_failed'

  for (const metricSet of metricSets) {
    const url =
      `${params.apiBase}/${params.mediaId}/insights?metric=${metricSet.join(',')}&access_token=${params.accessToken}`

    const response = await fetch(url, {
      signal: AbortSignal.timeout(25_000),
    })

    const raw = await response.json().catch(() => null) as {
      data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>
      error?: { message?: string }
    } | null

    if (!response.ok || !raw?.data) {
      lastError = raw?.error?.message ?? `instagram_media_insights_failed:${response.status}`
      continue
    }

    const metrics: Record<string, number> = {}
    for (const item of raw.data) {
      if (!item?.name) continue
      metrics[item.name] = parseNumber(item.values?.[0]?.value)
    }

    return {
      metrics,
      raw,
      usedMetricSet: [...metricSet],
    }
  }

  throw new Error(lastError)
}
