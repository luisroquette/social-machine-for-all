/**
 * REGRESSÃO: curator-feedback — peso por autor aprendido do reach real (fase 2)
 *
 * Análise: source_author prevê o reach dos nossos reels (BrianRoemmele ~874 vs OpenAI ~90,
 * mediana ~102). Optimization 10 do Curator multiplica a virality score por este peso.
 *
 * Trava: amostra pequena = neutro; suavização por raiz; clamp [0.6, 1.6]; sem referência = neutro.
 */

import { describe, it, expect } from 'vitest'
import { computeAuthorWeight } from './curator-feedback'

describe('REGRESSÃO: computeAuthorWeight', () => {
  it('amostra < 3 reels → neutro (1.0), sinal insuficiente', () => {
    expect(computeAuthorWeight(900, 102, 2)).toBe(1)
  })

  it('sem referência (median 0) → neutro', () => {
    expect(computeAuthorWeight(500, 0, 5)).toBe(1)
  })

  it('autor de alto reach é impulsionado, mas limitado a 1.6', () => {
    // sqrt(874/102)=2.93 → clamp 1.6
    expect(computeAuthorWeight(874, 102, 3)).toBe(1.6)
  })

  it('autor próximo da mediana ≈ neutro', () => {
    expect(computeAuthorWeight(102, 102, 5)).toBe(1)
  })

  it('autor de baixo reach é suavemente penalizado (acima do piso 0.6)', () => {
    // sqrt(84/102)=0.907
    const w = computeAuthorWeight(84, 102, 4)
    expect(w).toBeGreaterThan(0.6)
    expect(w).toBeLessThan(1)
  })

  it('penalização nunca abaixo do piso 0.6 (autor péssimo)', () => {
    expect(computeAuthorWeight(5, 1000, 10)).toBe(0.6)
  })
})
