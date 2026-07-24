/**
 * REGRESSÃO: publish com retry após FINISHED (bug ig_poll_timeout — 16/06/2026)
 *
 * O reels-publish chamava media_publish uma única vez no instante do FINISHED e
 * engolia o erro. Quando o Instagram respondia transitoriamente sem `id` (container
 * ainda não publicável), o reel ia para `failed` mesmo estando pronto — um retry
 * manual segundos depois publicava na hora. Estes testes garantem o retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { publishFinishedContainer } from './publish-container'

const BASE = 'https://graph.facebook.com/v21.0'
const USER = '17841477880013573'
const TOKEN = 'EAA_token'
const CREATION = '17884623219596001'

function jsonResponse(status: number, body: unknown) {
  return { status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('publishFinishedContainer', () => {
  it('publica de primeira quando media_publish retorna id', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { id: '18002165486945729' }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await publishFinishedContainer(BASE, USER, TOKEN, CREATION, 0)

    expect(r).toEqual({ id: '18002165486945729', error: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('REGRESSÃO: faz retry quando o primeiro media_publish falha transitoriamente e depois publica', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: 9007, message: 'Media not ready' } }))
      .mockResolvedValueOnce(jsonResponse(400, { error: { code: 9007, message: 'Media not ready' } }))
      .mockResolvedValueOnce(jsonResponse(200, { id: '18002165486945729' }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await publishFinishedContainer(BASE, USER, TOKEN, CREATION, 0)

    expect(r.id).toBe('18002165486945729')
    expect(r.error).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3) // 2 falhas + 1 sucesso
  })

  it('retorna o erro real (não null silencioso) quando todas as tentativas falham', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(400, { error: { code: 9007, message: 'Media not ready' } }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const r = await publishFinishedContainer(BASE, USER, TOKEN, CREATION, 0)

    expect(r.id).toBeNull()
    expect(r.error).toContain('9007')
    expect(r.error).toContain('Media not ready')
    expect(fetchMock).toHaveBeenCalledTimes(5) // maxAttempts
  })

  it('usa http_<status> como erro quando a resposta não tem campo error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, {}))
    vi.stubGlobal('fetch', fetchMock)

    const r = await publishFinishedContainer(BASE, USER, TOKEN, CREATION, 0)

    expect(r.id).toBeNull()
    expect(r.error).toBe('http_500')
  })
})
