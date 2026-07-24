/**
 * REGRESSÃO: snapshot de seguidores (medição view->follow — 16/06/2026)
 *
 * O perfil tinha muitas views e poucos seguidores, mas o sistema não media
 * seguidores. fetchFollowerCount usa o campo básico followers_count (funciona sem
 * o scope instagram_manage_insights) e nunca lança — em erro retorna null para não
 * derrubar o cron de métricas.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchFollowerCount } from './follower-count'

const BASE = 'https://graph.facebook.com/v21.0'
const ID = '17841477880013573'
const TOKEN = 'EAA_test'

function res(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body } as unknown as Response
}

afterEach(() => vi.restoreAllMocks())

describe('fetchFollowerCount', () => {
  it('retorna followers/media quando a API responde', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(true, { followers_count: 470, media_count: 363 })))
    expect(await fetchFollowerCount(BASE, ID, TOKEN)).toEqual({ followersCount: 470, mediaCount: 363 })
  })

  it('media_count ausente → assume 0', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(true, { followers_count: 500 })))
    expect(await fetchFollowerCount(BASE, ID, TOKEN)).toEqual({ followersCount: 500, mediaCount: 0 })
  })

  it('resposta não-ok → null (não lança)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(false, { error: { message: 'x' } })))
    expect(await fetchFollowerCount(BASE, ID, TOKEN)).toBeNull()
  })

  it('followers_count ausente → null (resposta inesperada)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(true, { media_count: 10 })))
    expect(await fetchFollowerCount(BASE, ID, TOKEN)).toBeNull()
  })

  it('timeout/erro de rede → null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await fetchFollowerCount(BASE, ID, TOKEN)).toBeNull()
  })

  it('sem id/token → null (não faz request)', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await fetchFollowerCount(BASE, '', TOKEN)).toBeNull()
    expect(await fetchFollowerCount(BASE, ID, '')).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })
})
