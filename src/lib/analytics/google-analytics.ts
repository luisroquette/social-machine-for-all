/**
 * Google Analytics 4 Data API + Search Console API clients.
 * Env vars: GOOGLE_GA4_PROPERTY_ID (format: "properties/XXXXXXXXX")
 */

import { getGoogleAccessToken, isGoogleConfigured } from './google-auth'

export interface AnalyticsReport {
  rows: Array<{
    dimensions: Record<string, string>
    metrics: Record<string, number>
  }>
  totalRows: number
  period: string
}

export interface SearchConsoleReport {
  rows: Array<{
    keys: string[]
    clicks: number
    impressions: number
    ctr: number
    position: number
  }>
  period: string
}

/**
 * Run a GA4 report via the Analytics Data API.
 * https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runReport
 */
export async function runGA4Report(options: {
  dimensions: string[]
  metrics: string[]
  dateRange: { startDate: string; endDate: string }
  limit?: number
  orderBy?: { metric: string; desc?: boolean }
}): Promise<AnalyticsReport> {
  const propertyId = process.env.GOOGLE_GA4_PROPERTY_ID
  if (!propertyId) throw new Error('GOOGLE_GA4_PROPERTY_ID nao configurado.')
  if (!isGoogleConfigured()) throw new Error('Google OAuth nao configurado.')

  const token = await getGoogleAccessToken()

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: options.dateRange.startDate, endDate: options.dateRange.endDate }],
    dimensions: options.dimensions.map((d) => ({ name: d })),
    metrics: options.metrics.map((m) => ({ name: m })),
    limit: options.limit ?? 50,
  }

  if (options.orderBy) {
    body.orderBys = [{ metric: { metricName: options.orderBy.metric }, desc: options.orderBy.desc ?? true }]
  }

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`GA4 API error: ${err.slice(0, 300)}`)
  }

  const data = await res.json()
  const dimensionHeaders = (data.dimensionHeaders ?? []).map((h: { name: string }) => h.name)
  const metricHeaders = (data.metricHeaders ?? []).map((h: { name: string }) => h.name)

  const rows = (data.rows ?? []).map((row: { dimensionValues: Array<{ value: string }>; metricValues: Array<{ value: string }> }) => {
    const dimensions: Record<string, string> = {}
    const metrics: Record<string, number> = {}

    row.dimensionValues?.forEach((v, i) => { dimensions[dimensionHeaders[i]] = v.value })
    row.metricValues?.forEach((v, i) => { metrics[metricHeaders[i]] = Number(v.value) || 0 })

    return { dimensions, metrics }
  })

  return {
    rows,
    totalRows: data.rowCount ?? rows.length,
    period: `${options.dateRange.startDate} a ${options.dateRange.endDate}`,
  }
}

/**
 * Query Google Search Console Performance API.
 * https://developers.google.com/webmaster-tools/v1/searchanalytics/query
 */
export async function querySearchConsole(options: {
  siteUrl: string
  startDate: string
  endDate: string
  dimensions?: string[]
  rowLimit?: number
  dimensionFilterGroups?: Array<{
    filters: Array<{
      dimension: string
      operator: string
      expression: string
    }>
  }>
}): Promise<SearchConsoleReport> {
  if (!isGoogleConfigured()) throw new Error('Google OAuth nao configurado.')

  const token = await getGoogleAccessToken()

  const body: Record<string, unknown> = {
    startDate: options.startDate,
    endDate: options.endDate,
    dimensions: options.dimensions ?? ['query'],
    rowLimit: options.rowLimit ?? 50,
    type: 'web',
  }

  if (options.dimensionFilterGroups) {
    body.dimensionFilterGroups = options.dimensionFilterGroups
  }

  // URL-encode the siteUrl for the API path
  const encodedSiteUrl = encodeURIComponent(options.siteUrl)

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodedSiteUrl}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Search Console API error: ${err.slice(0, 300)}`)
  }

  const data = await res.json()

  return {
    rows: (data.rows ?? []).map((row: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }) => ({
      keys: row.keys,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Math.round(row.ctr * 10000) / 100, // Convert to percentage
      position: Math.round(row.position * 10) / 10,
    })),
    period: `${options.startDate} a ${options.endDate}`,
  }
}
