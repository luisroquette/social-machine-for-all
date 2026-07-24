/**
 * getVideoStatistics: coleta de engajamento JÁ ALCANÇADO do YouTube
 * (view/like/comment count reais) — antes deste fix, source_metrics de
 * candidatos YouTube não tinha NENHUM dado de engajamento (achado 2026-07-11,
 * ver brand-brazil-launch.ts), então nada podia ser validado como "já viral".
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { getVideoStatistics } from './reader'

function res(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

beforeEach(() => {
  process.env.YOUTUBE_API_KEY = 'test-key'
})

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.YOUTUBE_API_KEY
})

describe('getVideoStatistics', () => {
  it('retorna vazio sem chamar a API quando não há IDs', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await getVideoStatistics([])).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('mapeia viewCount/likeCount/commentCount por videoId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(true, {
      items: [
        { id: 'abc', statistics: { viewCount: '15000', likeCount: '820', commentCount: '45' } },
        { id: 'def', statistics: { viewCount: '300' } }, // sem likeCount/commentCount
      ],
    })))
    const stats = await getVideoStatistics(['abc', 'def'])
    expect(stats.abc).toEqual({ viewCount: 15000, likeCount: 820, commentCount: 45 })
    expect(stats.def).toEqual({ viewCount: 300, likeCount: 0, commentCount: 0 })
  })

  it('likeCount ausente (contagem pública desabilitada) cai para 0, não quebra', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(true, {
      items: [{ id: 'xyz', statistics: { viewCount: '9999' } }],
    })))
    const stats = await getVideoStatistics(['xyz'])
    expect(stats.xyz.likeCount).toBe(0)
  })

  it('resposta não-ok lança erro (mesmo padrão das outras funções do reader)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(false, { error: 'quota exceeded' })))
    await expect(getVideoStatistics(['abc'])).rejects.toThrow(/YouTube statistics failed/)
  })

  it('faz batch de 50 IDs por chamada quando passa desse limite', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(true, { items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`)
    await getVideoStatistics(ids)
    expect(fetchMock).toHaveBeenCalledTimes(3) // 50 + 50 + 20
  })

  it('videoId sem correspondencia no resultado (deletado/privado) e simplesmente omitido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(true, { items: [] })))
    const stats = await getVideoStatistics(['deleted-video'])
    expect(stats).toEqual({})
  })
})
