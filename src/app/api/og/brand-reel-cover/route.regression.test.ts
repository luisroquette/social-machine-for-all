/**
 * REGRESSÃO: hookSize overflow na safe zone da capa Brand (bug 2026-05-20)
 *
 * Bug: hookSize usava tabela hardcoded. Para 11 chars (ex: "CAZAQUISTÃO"),
 * retornava 156px → texto ~1030px → overflow além dos 936px da safe zone.
 * Na grade do feed, a última letra ficava cortada.
 *
 * Fix: fórmula fontSize = floor(AVAILABLE_W / (len × CHAR_RATIO))
 * onde AVAILABLE_W = 1080 - 2×72 = 936, CHAR_RATIO = 0.65 (conservative).
 *
 * Invariante obrigatória: hookSize(len) × len × CHAR_RATIO ≤ AVAILABLE_W
 */

import { describe, it, expect } from 'vitest'
import { hookSize } from './route'

const AVAILABLE_W = 936  // 1080 - 2×72
const CHAR_RATIO  = 0.65

describe('REGRESSÃO: hookSize — texto sempre cabe na safe zone (bug 2026-05-20)', () => {
  it('OVERFLOW: hookSize(11) deve produzir texto ≤ 936px ("CAZAQUISTÃO" não corta)', () => {
    const size = hookSize(11)
    const estimatedWidth = size * 11 * CHAR_RATIO
    expect(estimatedWidth).toBeLessThanOrEqual(AVAILABLE_W)
    // Valor concreto: antes era 156px (overflow), agora ≤ 144px
    expect(size).toBeLessThanOrEqual(144)
  })

  it('INVARIANTE: hookSize(len) × len × 0.65 ≤ 936 para len 1-30', () => {
    for (let len = 1; len <= 30; len++) {
      const size = hookSize(len)
      const estimatedWidth = size * len * CHAR_RATIO
      expect(estimatedWidth, `len=${len} size=${size} → estimatedWidth=${estimatedWidth.toFixed(1)}`).toBeLessThanOrEqual(AVAILABLE_W)
    }
  })

  it('LIMITES: máximo 220px respeitado, sem piso artificial que cause overflow', () => {
    expect(hookSize(1)).toBe(220)        // título de 1 char → max
    expect(hookSize(100)).toBeGreaterThan(0)  // comprimento absurdo → fórmula não crasha
    // Sem piso: floor(936/(100×0.65)) = 14px — ridiculamente pequeno mas sem overflow
    expect(hookSize(100) * 100 * 0.65).toBeLessThanOrEqual(936)
  })

  it('PALAVRAS COMUNS: tamanhos razoáveis para palavras típicas de hook', () => {
    expect(hookSize(4)).toBe(220)   // "BEBA", "ELON"
    expect(hookSize(5)).toBeLessThanOrEqual(220)  // "TESLA", "CHINA"
    expect(hookSize(6)).toBeLessThanOrEqual(220)  // "BRASIL", "NVIDIA"
    expect(hookSize(7)).toBeGreaterThan(60)       // "SAMSUNG"
    expect(hookSize(11)).toBeGreaterThan(60)      // "CAZAQUISTÃO"
  })
})
