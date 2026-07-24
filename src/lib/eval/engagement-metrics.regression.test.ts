/**
 * REGRESSÃO: reels-metrics — captura de engajamento (jun/2026)
 *
 * Bugs travados por este teste:
 *
 * 1. CLOBBER do review_score: o cron reels-metrics gravava o engagement score em
 *    `review_score` e o JSON de métricas em `review_feedback`, sobrescrevendo o sinal
 *    de QUALIDADE do Reviewer. Resultado: review_score médio dos reels caiu p/ ~2.24.
 *    Fix: colunas dedicadas (engagement_score, engagement_metrics, reach, engagement_rate).
 *    buildEngagementUpdate NUNCA pode escrever review_score/review_feedback.
 *
 * 2. FALHA SILENCIOSA de credencial: o `/insights` retornava #10 (app sem
 *    instagram_manage_insights) / #190 (token expirado) e o cron caía num `continue`
 *    silencioso — métricas pararam por 5 semanas sem ninguém ver. parsePermanentAuthError
 *    detecta esses códigos para disparar alerta + Sentry.
 *
 * 3. Conjunto de métricas e fórmula de engagement_rate / score estáveis.
 */

import { describe, it, expect } from 'vitest'
import {
  IG_INSIGHTS_METRICS,
  computeEngagementRate,
  calculateEngagementScore,
  buildEngagementUpdate,
  parsePermanentAuthError,
  type ReelEngagement,
} from './engagement-metrics'

function sampleEngagement(over: Partial<ReelEngagement> = {}): ReelEngagement {
  return {
    reach: 100,
    likes: 5,
    comments: 2,
    saved: 1,
    shares: 1,
    total_interactions: 9,
    avg_watch_time_ms: 5000,
    total_view_time_ms: 500000,
    fetched_at: '2026-06-16T21:00:00.000Z',
    ...over,
  }
}

describe('REGRESSÃO: buildEngagementUpdate NUNCA toca review_score/review_feedback', () => {
  const update = buildEngagementUpdate(sampleEngagement())
  const keys = Object.keys(update)

  it('não inclui review_score', () => {
    expect(keys).not.toContain('review_score')
  })

  it('não inclui review_feedback', () => {
    expect(keys).not.toContain('review_feedback')
  })

  it('inclui exatamente as 4 colunas dedicadas de engajamento', () => {
    expect(keys.sort()).toEqual(['engagement_metrics', 'engagement_rate', 'engagement_score', 'reach'].sort())
  })

  it('engagement_metrics preserva o JSON bruto das métricas', () => {
    expect(update.engagement_metrics.reach).toBe(100)
    expect(update.engagement_metrics.fetched_at).toBe('2026-06-16T21:00:00.000Z')
  })
})

describe('REGRESSÃO: computeEngagementRate — fórmula e gate de reach', () => {
  it('reach > 0: (likes+comments+saved+shares)/reach * 100, 2 casas', () => {
    // (5+2+1+1)/100 = 9% → 9
    expect(computeEngagementRate(sampleEngagement())).toBe(9)
  })

  it('reach = 0 → 0 (sem divisão por zero)', () => {
    expect(computeEngagementRate(sampleEngagement({ reach: 0 }))).toBe(0)
  })
})

describe('REGRESSÃO: calculateEngagementScore', () => {
  it('reach = 0 → 0', () => {
    expect(calculateEngagementScore(sampleEngagement({ reach: 0 }))).toBe(0)
  })

  it('reach > 0 → score numérico no intervalo 0-10', () => {
    const s = calculateEngagementScore(sampleEngagement())
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThanOrEqual(10)
  })
})

describe('REGRESSÃO: conjunto de métricas de insights', () => {
  it('inclui reach (métrica essencial p/ engagement_rate)', () => {
    expect(IG_INSIGHTS_METRICS.split(',')).toContain('reach')
  })

  it('inclui as métricas de interação e watch-time esperadas', () => {
    const set = IG_INSIGHTS_METRICS.split(',')
    for (const m of ['likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time']) {
      expect(set).toContain(m)
    }
  })
})

describe('REGRESSÃO: parsePermanentAuthError — falha de credencial NÃO pode ser silenciosa', () => {
  it('detecta #10 (app sem instagram_manage_insights)', () => {
    const body = JSON.stringify({ error: { message: 'Application does not have permission for this action', code: 10 } })
    expect(parsePermanentAuthError(body)).toEqual({ code: 10, message: 'Application does not have permission for this action' })
  })

  it('detecta #190 (token expirado)', () => {
    const body = JSON.stringify({ error: { message: 'Session has expired', code: 190 } })
    expect(parsePermanentAuthError(body)?.code).toBe(190)
  })

  it('detecta #200 (permissão insuficiente)', () => {
    expect(parsePermanentAuthError(JSON.stringify({ error: { code: 200, message: 'x' } }))?.code).toBe(200)
  })

  it('ignora erro transiente/não-credencial (ex: #4 rate limit)', () => {
    expect(parsePermanentAuthError(JSON.stringify({ error: { code: 4, message: 'rate limit' } }))).toBeNull()
  })

  it('corpo não-JSON → null (não quebra)', () => {
    expect(parsePermanentAuthError('<html>502</html>')).toBeNull()
  })
})
