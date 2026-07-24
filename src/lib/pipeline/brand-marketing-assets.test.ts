import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetInstagramCredentials = vi.fn()
vi.mock('@/lib/settings/load-credentials', () => ({
  getInstagramCredentials: (...args: unknown[]) => mockGetInstagramCredentials(...args),
}))

const mockPublishImage = vi.fn()
const mockPostComment = vi.fn()
vi.mock('@/lib/platforms/instagram/client', () => ({
  InstagramClient: {
    fromWorkspace: () => ({ publishImage: mockPublishImage, postComment: mockPostComment }),
  },
  splitHashtags: (caption: string) => {
    const hashtags = (caption.match(/#\w+/g) ?? []).join(' ')
    const cleanCaption = caption.replace(/#\w+/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    return { cleanCaption, hashtags }
  },
}))

const mockBuildStoryQueuePatch = vi.fn().mockReturnValue({
  story_cover_url: 'https://example.com/cover.jpg',
  story_publish_after: '2026-01-01T00:00:00.000Z',
  story_delay_minutes: 20,
})
vi.mock('@/lib/agents/publisher/index', () => ({
  buildStoryQueuePatch: (...args: unknown[]) => mockBuildStoryQueuePatch(...args),
}))

let unusedAsset: Record<string, unknown> | null = null
const assetUpdates: Array<{ id: string; used_at: unknown }> = []
const generatedContentInserts: Array<Record<string, unknown>> = []
const generatedContentUpdates: Array<{ id: string; patch: Record<string, unknown> }> = []
const isFilterCalls: Array<[string, unknown]> = []

const mockFromFn = vi.fn((table: string) => {
  if (table === 'brand_marketing_assets') {
    return {
      select: () => ({
        eq: () => ({
          is: (col: string, val: unknown) => {
            isFilterCalls.push([col, val])
            return {
              is: (col2: string, val2: unknown) => {
                isFilterCalls.push([col2, val2])
                return {
                  order: () => ({
                    limit: () => ({
                      maybeSingle: () => Promise.resolve(unusedAsset ? { data: unusedAsset, error: null } : { data: null, error: null }),
                    }),
                  }),
                }
              },
            }
          },
        }),
      }),
      update: (patch: { used_at: unknown }) => ({
        eq: (_col: string, id: string) => {
          assetUpdates.push({ id, used_at: patch.used_at })
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }
  }
  if (table === 'generated_content') {
    return {
      insert: (payload: Record<string, unknown>) => {
        generatedContentInserts.push(payload)
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: 'generated-content-1' }, error: null }),
          }),
        }
      },
      update: (patch: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => {
          generatedContentUpdates.push({ id, patch })
          return Promise.resolve({ data: null, error: null }).then((r) => r, () => {})
        },
      }),
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

const mockStorageUpload = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: mockFromFn,
    storage: {
      from: () => ({
        upload: mockStorageUpload,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.example.com/brand-mob/${path}` } }),
      }),
    },
  }),
}))

import { publishNextMarketingAsset } from './brand-marketing-assets'

const WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

const BASE_ASSET = {
  id: 'asset-1',
  public_url: 'https://storage.example.com/marketing-assets/post/post-01-1x1.jpg',
  caption: 'Hook da legenda\n\nResto do texto #hashtag',
  pillar: 'dor',
}

beforeEach(() => {
  vi.clearAllMocks()
  assetUpdates.length = 0
  generatedContentInserts.length = 0
  generatedContentUpdates.length = 0
  isFilterCalls.length = 0
  unusedAsset = { ...BASE_ASSET }
  mockGetInstagramCredentials.mockResolvedValue({ appId: 'app', igUserId: 'ig-user', accessToken: 'token' })
  mockPublishImage.mockResolvedValue({ success: true, postId: 'post-123', postUrl: 'https://instagram.com/p/abc' })
  mockPostComment.mockResolvedValue(undefined)
  mockStorageUpload.mockClear()
  mockStorageUpload.mockResolvedValue({ error: null })
  // render da moldura 3:4 (fetch da rota brand-asset-frame)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))
})

describe('publishNextMarketingAsset', () => {
  it('publica o asset mais antigo não usado (via moldura 3:4) e marca used_at', async () => {
    const result = await publishNextMarketingAsset(WORKSPACE_ID)

    // REGRESSÃO 07/07/2026: a grade do IG é 3:4 — o asset 1:1 vai embrulhado
    // na moldura brand-asset-frame (renderizada e persistida no Storage),
    // nunca publicado cru.
    expect(mockPublishImage).toHaveBeenCalledWith(
      expect.not.stringContaining('#hashtag'),
      'https://storage.example.com/brand-mob/marketing-frames/asset-1.png',
      expect.any(String),
    )
    expect(mockStorageUpload).toHaveBeenCalled()
    expect(mockPostComment).toHaveBeenCalledWith('post-123', expect.stringContaining('#hashtag'))
    expect(result).toEqual({ success: true, assetId: 'asset-1', postUrl: 'https://instagram.com/p/abc' })
    expect(assetUpdates).toEqual([{ id: 'asset-1', used_at: expect.any(String) }])
  })

  it('REGRESSÃO: se o render da moldura falhar, publica via rota edge (fallback)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('edge timeout')))

    const result = await publishNextMarketingAsset(WORKSPACE_ID)

    expect(mockPublishImage).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining(`/api/og/brand-asset-frame?img=${encodeURIComponent(BASE_ASSET.public_url as string)}`),
      expect.any(String),
    )
    expect(result).toEqual({ success: true, assetId: 'asset-1', postUrl: 'https://instagram.com/p/abc' })
  })

  it('REGRESSÃO: hashtags são removidas da legenda e postadas em comentário separado, não inline', async () => {
    await publishNextMarketingAsset(WORKSPACE_ID)

    const captionSentToInstagram = mockPublishImage.mock.calls[0][0] as string
    expect(captionSentToInstagram).not.toContain('#')
    expect(mockPostComment).toHaveBeenCalledWith('post-123', expect.stringContaining('#hashtag'))
  })

  it('grava generated_content com status=published e enfileira Story', async () => {
    await publishNextMarketingAsset(WORKSPACE_ID)

    expect(generatedContentInserts).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_ID,
        target_platform: 'instagram',
        target_format: 'post',
        status: 'published',
        published_id: 'post-123',
        published_url: 'https://instagram.com/p/abc',
      }),
    ])
    expect(mockBuildStoryQueuePatch).toHaveBeenCalledWith(BASE_ASSET.public_url)
    expect(generatedContentUpdates).toEqual([{ id: 'generated-content-1', patch: expect.any(Object) }])
  })

  it('REGRESSÃO 08/07/2026: exclui assets fixados numa data comemorativa (seasonal_slug) do pool round-robin — só o cron seasonal-brand pode publicá-los', async () => {
    await publishNextMarketingAsset(WORKSPACE_ID)

    expect(isFilterCalls).toEqual(
      expect.arrayContaining([
        ['used_at', null],
        ['seasonal_slug', null],
      ]),
    )
  })

  it('retorna null quando não há asset não-usado disponível', async () => {
    unusedAsset = null

    const result = await publishNextMarketingAsset(WORKSPACE_ID)

    expect(result).toBeNull()
    expect(mockPublishImage).not.toHaveBeenCalled()
  })

  it('retorna success:false sem publicar quando faltam credenciais do Instagram', async () => {
    mockGetInstagramCredentials.mockResolvedValue({ appId: 'app', igUserId: '', accessToken: '' })

    const result = await publishNextMarketingAsset(WORKSPACE_ID)

    expect(mockPublishImage).not.toHaveBeenCalled()
    expect(result?.success).toBe(false)
    expect(assetUpdates).toEqual([])
  })

  it('REGRESSÃO: quando a publicação falha, NÃO marca used_at (permite retry no próximo run)', async () => {
    mockPublishImage.mockResolvedValue({ success: false, error: 'Container creation failed: rate limited' })

    const result = await publishNextMarketingAsset(WORKSPACE_ID)

    expect(result).toEqual({ success: false, assetId: 'asset-1', error: 'Container creation failed: rate limited' })
    expect(assetUpdates).toEqual([])
    expect(generatedContentInserts).toEqual([
      expect.objectContaining({ status: 'failed', review_feedback: 'Container creation failed: rate limited' }),
    ])
  })
})
