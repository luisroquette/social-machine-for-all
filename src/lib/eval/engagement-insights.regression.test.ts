/**
 * REGRESSÃO: engagement-insights — aprendizado por reach real (fase 2, jun/2026)
 *
 * Análise do corpus provou: reach é o KPI (não engagement_rate, ruidoso em reach baixo),
 * e reach é puxado por RETENÇÃO (watch time) → gancho, não legenda. Este bloco injeta os
 * ganchos vencedores + o sinal de retenção no Writer/Reviewer.
 *
 * Trava: bloco vazio sem sinal; inclui retenção só quando high>low; lista ganchos;
 * sempre traz o guardrail "protagonista só da fonte" (não inventar nomes).
 */

import { describe, it, expect } from 'vitest'
import { formatEngagementInsights } from './engagement-insights'

const TOP = [
  { hook: 'O CARA QUE DELETOU O CHATGPT', reach: 7906, watchMs: 7471 },
  { hook: 'O ATOR QUE CONVERSA COM IA DE MADRUGADA', reach: 12774, watchMs: 10524 },
]

describe('REGRESSÃO: formatEngagementInsights', () => {
  it('retorna vazio quando não há ganchos (sem sinal → não polui o prompt)', () => {
    expect(formatEngagementInsights([], 11000, 4000, 0)).toBe('')
  })

  it('lista os ganchos que mais alcançaram', () => {
    const out = formatEngagementInsights(TOP, 11000, 4000, 50)
    expect(out).toContain('O CARA QUE DELETOU O CHATGPT')
    expect(out).toContain('7.906') // reach formatado pt-BR
  })

  it('inclui o sinal de retenção quando high > low', () => {
    const out = formatEngagementInsights(TOP, 11600, 4600, 50)
    expect(out).toMatch(/11\.6s/)
    expect(out).toMatch(/4\.6s/)
    expect(out.toLowerCase()).toContain('retenção')
  })

  it('omite a linha de retenção quando não há contraste (high <= low ou null)', () => {
    const out = formatEngagementInsights(TOP, null, null, 50)
    expect(out).not.toMatch(/retenção nos primeiros segundos/i)
    // mas ainda lista ganchos
    expect(out).toContain('O CARA QUE DELETOU O CHATGPT')
  })

  it('sempre reforça o guardrail anti-fabricação (protagonista só da fonte)', () => {
    const out = formatEngagementInsights(TOP, 11600, 4600, 50)
    expect(out.toLowerCase()).toContain('nunca invente')
    expect(out.toLowerCase()).toContain('ia/tech')
  })
})
