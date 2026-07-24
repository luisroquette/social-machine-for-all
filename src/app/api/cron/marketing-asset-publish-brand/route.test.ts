import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.fn()
vi.mock('@/lib/pipeline/brand-marketing-assets', () => ({
  publishNextMarketingAsset: (...args: unknown[]) => mockPublish(...args),
}))

vi.mock('@/lib/api/auth', () => ({
  isCronRequest: (req: Request) => req.headers.get('authorization') === 'Bearer test-secret',
}))

beforeEach(() => {
  mockPublish.mockReset()
})

describe('GET /api/cron/marketing-asset-publish-brand', () => {
  it('retorna 401 sem autenticação de cron e não chama o publish', async () => {
    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/marketing-asset-publish-brand'))

    expect(res.status).toBe(401)
    expect(mockPublish).not.toHaveBeenCalled()
  })

  it('chama publishNextMarketingAsset com o workspace do Brand quando autenticado', async () => {
    mockPublish.mockResolvedValue({ success: true, assetId: 'asset-1', postUrl: 'https://instagram.com/p/abc' })
    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/marketing-asset-publish-brand', {
      headers: { authorization: 'Bearer test-secret' },
    }))
    const body = await res.json()

    expect(mockPublish).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000000')
    expect(body.success).toBe(true)
    expect(body.assetId).toBe('asset-1')
  })

  it('retorna success:false (200) quando não há assets não-usados, sem lançar erro', async () => {
    mockPublish.mockResolvedValue(null)
    const { GET } = await import('./route')
    const res = await GET(new Request('http://localhost/api/cron/marketing-asset-publish-brand', {
      headers: { authorization: 'Bearer test-secret' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.reason).toBe('no_unused_assets')
  })
})
