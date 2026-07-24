/**
 * REGRESSÃO: orçamento de tempo do reels-publish (cron principal, roda de hora em hora
 * para @ai_br_videos e @brand) nunca pode ultrapassar o maxDuration=300s (bug 2026-07-15).
 *
 * Achado nesta investigação (continuação do fix em publisher/index.ts, commit a66f95a):
 * o mesmo tipo de estouro estrutural de orçamento existia aqui, e de forma MAIS grave —
 * não era só pior-caso, era o caso NOMINAL. Com os valores configurados em produção antes
 * do fix: @ai_br_videos tinha `video_render_timeout_ms=200000` (200s) + poll do Instagram
 * `24 tentativas × 5s = 120s` nominal — render + poll sozinhos já somavam 320s > 300s,
 * sem precisar de nenhum travamento. @brand tinha poll `18 × 10s = 180s` nominal.
 *
 * Além disso, 4 fetches não tinham NENHUM timeout — criação de container, poll de status,
 * media_publish (dentro de publishFinishedContainer) e o comentário de hashtags — cobertos
 * só pelo laço de tentativas, que limita ITERAÇÕES, não o tempo de uma chamada individual.
 *
 * Fix: timeout explícito em todo fetch; valores de render/poll reduzidos (banco de produção
 * E defaults de código) para caber com folga segura em 300s.
 *
 * Este teste fixa a INVARIANTE (soma do pior caso nominal < maxDuration - margem), usando os
 * DEFAULTS de código como base — os valores de produção no banco foram ajustados à parte.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROUTE_SRC = readFileSync(join(process.cwd(), 'src/app/api/cron/reels-publish/route.ts'), 'utf-8')
const SETTINGS_SRC = readFileSync(join(process.cwd(), 'src/lib/settings/load-settings.ts'), 'utf-8')
const PUBLISH_CONTAINER_SRC = readFileSync(join(process.cwd(), 'src/lib/platforms/instagram/publish-container.ts'), 'utf-8')

function extractSettingDefault(src: string, key: string): number {
  const re = new RegExp(`key: '${key}'[^}]*defaultValue: '(\\d+)'`)
  const match = src.match(re)
  if (!match) throw new Error(`default not found for setting: ${key}`)
  return Number(match[1])
}

function extractParamDefault(src: string, paramName: string): number {
  const re = new RegExp(`${paramName}\\s*=\\s*(\\d[\\d_]*),`)
  const match = src.match(re)
  if (!match) throw new Error(`param default not found: ${paramName}`)
  return Number(match[1].replace(/_/g, ''))
}

describe('REGRESSÃO: orçamento de timeout do reels-publish cabe no maxDuration (bug 2026-07-15)', () => {
  it('declara maxDuration explícito', () => {
    expect(ROUTE_SRC).toContain('export const maxDuration = 300')
  })

  it('todo fetch da etapa de publicação no Instagram tem timeout — nenhum pode travar indefinidamente', () => {
    // Antes do fix: criação de container, poll, media_publish e comentário de hashtags
    // não tinham NENHUM timeout.
    const containerCreateBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf('Creating container'))
    expect(containerCreateBlock.slice(0, 550)).toContain('AbortSignal.timeout')

    const pollBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf('Starting poll'))
    expect(pollBlock.slice(0, 950)).toContain('AbortSignal.timeout')

    const commentBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf('Hashtag comment delayed'))
    expect(commentBlock.slice(0, 500)).toContain('AbortSignal.timeout')

    expect(PUBLISH_CONTAINER_SRC).toContain('AbortSignal.timeout')
  })

  it('poll do Instagram trata falha de uma requisição individual sem derrubar o handler inteiro', () => {
    // Sem isso, um único poll travado (agora abortado pelo timeout) lançava uma exceção não
    // capturada que saía do laço e derrubava o handler — o item ficava em reel_ready sem
    // nenhum status explícito, e era reprocessado do zero na próxima hora, potencialmente
    // para sempre com o mesmo vídeo problemático.
    const pollBlock = ROUTE_SRC.slice(ROUTE_SRC.indexOf('Starting poll'), ROUTE_SRC.indexOf('lastPollResponse = JSON.stringify'))
    expect(pollBlock).toContain('.catch(')
  })

  it('soma do pior caso nominal (render/capa em paralelo + Instagram sequencial) cabe com folga em 300s', () => {
    const coverRenderTimeoutMs = extractSettingDefault(SETTINGS_SRC, 'cover_render_timeout_ms')
    const videoRenderTimeoutMs = extractSettingDefault(SETTINGS_SRC, 'video_render_timeout_ms')
    const parallelStepWorstCaseMs = Math.max(coverRenderTimeoutMs, videoRenderTimeoutMs)

    const containerCreateTimeoutMs = 15_000 // ver `signal: AbortSignal.timeout(15_000)` na criação de container
    const igPollIntervalMs = extractSettingDefault(SETTINGS_SRC, 'ig_poll_interval_ms')
    const igPollMaxAttempts = extractSettingDefault(SETTINGS_SRC, 'ig_poll_max_attempts')
    const igPollNominalMs = igPollIntervalMs * igPollMaxAttempts

    const publishDelayMs = extractParamDefault(PUBLISH_CONTAINER_SRC, 'delayMs')
    const publishMaxAttempts = extractParamDefault(PUBLISH_CONTAINER_SRC, 'maxAttempts')
    const publishPerAttemptTimeoutMs = 10_000 // ver AbortSignal.timeout em publish-container.ts
    const publishFinishedContainerWorstCaseMs = publishMaxAttempts * (publishDelayMs + publishPerAttemptTimeoutMs)

    const sequentialStepWorstCaseMs = containerCreateTimeoutMs + igPollNominalMs + publishFinishedContainerWorstCaseMs

    const totalWorstCaseMs = parallelStepWorstCaseMs + sequentialStepWorstCaseMs
    const maxDurationMs = 300_000

    const MIN_SAFETY_MARGIN_MS = 30_000
    expect(totalWorstCaseMs).toBeLessThan(maxDurationMs - MIN_SAFETY_MARGIN_MS)
  })

  it('video_render_timeout_ms não pode voltar ao valor antigo de 120s (default) — reduzia a folga do orçamento', () => {
    const videoRenderTimeoutMs = extractSettingDefault(SETTINGS_SRC, 'video_render_timeout_ms')
    expect(videoRenderTimeoutMs).toBeLessThanOrEqual(90_000)
  })

  it('ig_poll_max_attempts (default) não pode voltar ao valor antigo de 20 — poll nominal ficava sem folga segura', () => {
    const igPollMaxAttempts = extractSettingDefault(SETTINGS_SRC, 'ig_poll_max_attempts')
    expect(igPollMaxAttempts).toBeLessThanOrEqual(12)
  })
})
