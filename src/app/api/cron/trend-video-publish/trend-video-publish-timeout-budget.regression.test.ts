/**
 * REGRESSÃO: orçamento de tempo do trend-video-publish (bug 2026-07-15, achado por
 * auditoria contínua /loop).
 *
 * Achado: maxDuration=120 era MENOR que uma única etapa interna sozinha —
 * stitchTrendVideoClips (download paralelo até 60s + execFile do ffmpeg até 120s = até
 * 180s) já excedia o orçamento da função ANTES de somar geração de capa/endcard (~20s) e
 * o publish do carrossel misto no Instagram (publishMixedCarousel: loop sequencial de
 * criação+poll por item + poll final do carrossel).
 *
 * publishMixedCarousel também tinha 2 fetches sem NENHUM timeout (criação de container
 * por item, criação do container final do carrossel) e usava waitForContainer com o
 * valor antigo de 120s tanto para vídeo quanto para o poll final.
 *
 * Fix: timeout explícito nos 2 fetches; vídeo 120s→60s, poll final 120s→60s;
 * maxDuration 120→280 (ainda não cobre o pior caso absoluto de todas as etapas no teto
 * simultaneamente, ~380s — isso exigiria separar stitch/publish em crons distintos,
 * mudança de arquitetura fora do escopo de um fix de timeout).
 *
 * Este teste trava que os valores não regridam para os antigos, e que os fetches
 * continuem com timeout explícito.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/app/api/cron/trend-video-publish/route.ts'), 'utf-8')
const IG_CLIENT_SRC = readFileSync(join(process.cwd(), 'src/lib/platforms/instagram/client.ts'), 'utf-8')
const STITCH_SRC = readFileSync(join(process.cwd(), 'src/lib/video/stitch-trend-video.ts'), 'utf-8')

function extractNumber(src: string, marker: string, windowSize = 200): number {
  const idx = src.indexOf(marker)
  if (idx === -1) throw new Error(`marker not found: ${marker}`)
  const after = src.slice(idx + marker.length, idx + marker.length + windowSize)
  const match = after.match(/(\d[\d_]*)/)
  if (!match) throw new Error(`no number found after marker: ${marker}`)
  return Number(match[1].replace(/_/g, ''))
}

const PUBLISH_MIXED_CAROUSEL_SRC = IG_CLIENT_SRC.slice(
  IG_CLIENT_SRC.indexOf('async publishMixedCarousel('),
  IG_CLIENT_SRC.indexOf('async publish(text: string)'),
)

describe('REGRESSÃO: orçamento de timeout do trend-video-publish (bug 2026-07-15)', () => {
  it('maxDuration não pode voltar a 120s — era menor que uma única etapa interna (stitch, até 180s)', () => {
    const maxDurationMs = extractNumber(ROUTE_SRC, 'export const maxDuration = ') * 1000
    expect(maxDurationMs).toBeGreaterThanOrEqual(280_000)
  })

  it('publishMixedCarousel: criação de container por item e do carrossel final têm timeout explícito', () => {
    const childCreateBlock = PUBLISH_MIXED_CAROUSEL_SRC.slice(0, PUBLISH_MIXED_CAROUSEL_SRC.indexOf('childIds.push'))
    expect(childCreateBlock).toContain('AbortSignal.timeout')

    const finalCreateBlock = PUBLISH_MIXED_CAROUSEL_SRC.slice(PUBLISH_MIXED_CAROUSEL_SRC.indexOf("media_type: 'CAROUSEL'"))
    expect(finalCreateBlock.slice(0, 400)).toContain('AbortSignal.timeout')
  })

  it('poll de vídeo por item e poll final do carrossel não podem voltar ao valor antigo de 120s', () => {
    const videoPollMs = extractNumber(PUBLISH_MIXED_CAROUSEL_SRC, "item.type === 'video' ? ")
    expect(videoPollMs).toBeLessThanOrEqual(90_000)

    const finalPollBlock = PUBLISH_MIXED_CAROUSEL_SRC.slice(PUBLISH_MIXED_CAROUSEL_SRC.indexOf('const ready = await this.waitForContainer(carouselData.id'))
    const finalPollMs = extractNumber(finalPollBlock, 'carouselData.id, accessToken, ')
    expect(finalPollMs).toBeLessThanOrEqual(90_000)
  })

  it('stitch de vídeo (download paralelo + ffmpeg) continua com timeout — não pode virar chamada sem limite', () => {
    expect(STITCH_SRC).toContain('AbortSignal.timeout')
    expect(STITCH_SRC).toContain('timeout: 120_000')
  })
})
