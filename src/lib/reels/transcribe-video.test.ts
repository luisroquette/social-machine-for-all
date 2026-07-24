/**
 * REGRESSÃO: transcribe com timeout (stall de produção de reels — 16/06/2026)
 *
 * O reels-prepare chamava /transcribe sem AbortSignal. Um Whisper travado no
 * Railway bloqueava o fetch até o Vercel matar a função (maxDuration), antes de
 * gravar qualquer reel_ready — o mesmo item-veneno era reprocessado a cada run,
 * travando a produção por dias. transcribeVideo nunca lança e sempre devolve um
 * fallback usável, então um transcribe lento não derruba mais o cron.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { transcribeVideo } from './transcribe-video'

const URL = 'https://railway.example'
const KEY = 'key'
const VIDEO = 'https://x/video.mp4'
const FALLBACK = 'texto original do tweet com mais de trinta caracteres aqui'

function res(ok: boolean, body: unknown, status = ok ? 200 : 500) {
  return { ok, status, text: async () => JSON.stringify(body) } as unknown as Response
}

afterEach(() => vi.restoreAllMocks())

describe('transcribeVideo', () => {
  it('retorna srt + texto quando há fala real', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      res(true, { srt: '1\n00:00 --> 00:01\nOlá mundo', text: 'Olá mundo, isso é uma fala real bem longa para passar do limite' }),
    ))
    const r = await transcribeVideo(URL, KEY, VIDEO, FALLBACK)
    expect(r.srtText).toContain('Olá mundo')
    expect(r.fullText).toContain('fala real')
  })

  it('REGRESSÃO: em timeout (fetch rejeita) NÃO lança e usa fallback sem SRT', async () => {
    // AbortSignal.timeout faz o fetch rejeitar — simulamos com reject
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    ))
    const r = await transcribeVideo(URL, KEY, VIDEO, FALLBACK, 50)
    expect(r).toEqual({ srtText: '', fullText: FALLBACK })
  })

  it('resposta não-ok → fallback sem SRT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res(false, {})))
    const r = await transcribeVideo(URL, KEY, VIDEO, FALLBACK)
    expect(r).toEqual({ srtText: '', fullText: FALLBACK })
  })

  it('áudio só com música → fallback sem SRT (não legenda trilha)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      res(true, { srt: 'x', text: '♪♪♪ música ♪♪♪' }),
    ))
    const r = await transcribeVideo(URL, KEY, VIDEO, FALLBACK)
    expect(r.srtText).toBe('')
    expect(r.fullText).toBe(FALLBACK)
  })

  it('JSON inválido → fallback sem SRT (não lança)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: true, status: 200, text: async () => 'não é json' } as unknown as Response,
    ))
    const r = await transcribeVideo(URL, KEY, VIDEO, FALLBACK)
    expect(r).toEqual({ srtText: '', fullText: FALLBACK })
  })
})
