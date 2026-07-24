/**
 * REGRESSÃO: garantia mínima de alerta "Instagram sem postagens" (2x/dia).
 *
 * Bug histórico: o heartbeat reativo (com dedup/cooldown/pause-week) silenciou
 * o outage do DoomGuyFrame por dias (29/06–04/07/2026). O usuário pediu uma
 * garantia independente: o alerta de "sistema parado / sem postagens" deve
 * disparar todo dia, pelo menos 2x, enquanto o problema persistir — sem
 * depender de nenhuma lógica de supressão.
 */
import { describe, it, expect } from 'vitest'
import { hoursSince, isInstagramStale } from './instagram-freshness'

describe('REGRESSÃO: digest de status do Instagram não pode ser suprimido', () => {
  it('nunca postou (lastPublishedAt null) → stale', () => {
    expect(isInstagramStale(hoursSince(Date.now(), null), 24)).toBe(true)
  })

  it('postou há 7 dias (caso real do outage) → stale', () => {
    const now = new Date('2026-07-04T12:00:00Z').getTime()
    const lastPost = '2026-06-27T21:16:11Z'
    expect(isInstagramStale(hoursSince(now, lastPost), 24)).toBe(true)
  })

  it('postou há 2h → NÃO stale', () => {
    const now = new Date('2026-07-04T12:00:00Z').getTime()
    const lastPost = '2026-07-04T10:00:00Z'
    expect(isInstagramStale(hoursSince(now, lastPost), 24)).toBe(false)
  })

  it('exatamente no limite (24h) → NÃO stale ainda; 24h+1min → stale', () => {
    const now = new Date('2026-07-04T12:00:00Z').getTime()
    expect(isInstagramStale(hoursSince(now, '2026-07-03T12:00:00Z'), 24)).toBe(false)
    expect(isInstagramStale(hoursSince(now, '2026-07-03T11:59:00Z'), 24)).toBe(true)
  })
})
