import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_INSTAGRAM_MEDIA_INSIGHT_METRIC_SETS, fetchInstagramMediaInsights } from './media-insights'

function jsonResponse(ok: boolean, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('fetchInstagramMediaInsights', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to the next metric set when the first one fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(false, 400, { error: { message: 'unsupported metric views' } }))
      .mockResolvedValueOnce(jsonResponse(true, 200, {
        data: [
          { name: 'reach', values: [{ value: 1200 }] },
          { name: 'total_views', values: [{ value: 980 }] },
        ],
      }))

    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchInstagramMediaInsights({
      apiBase: 'https://graph.facebook.com/v22.0',
      mediaId: '123',
      accessToken: 'token',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.metrics.reach).toBe(1200)
    expect(result.metrics.total_views).toBe(980)
    expect(result.usedMetricSet).toEqual([...DEFAULT_INSTAGRAM_MEDIA_INSIGHT_METRIC_SETS[1]])
  })

  it('throws the last API error when all metric sets fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse(false, 400, { error: { message: 'unsupported media insights' } })),
    ))

    await expect(fetchInstagramMediaInsights({
      apiBase: 'https://graph.facebook.com/v22.0',
      mediaId: '123',
      accessToken: 'token',
      metricSets: [['views'], ['reach']],
    })).rejects.toThrow('unsupported media insights')
  })
})
