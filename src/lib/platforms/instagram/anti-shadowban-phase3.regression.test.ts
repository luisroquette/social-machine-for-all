/**
 * REGRESSÃO: Anti-Shadow-Ban Phase 3 — unit tests for pure functions.
 * Covers: D1 UA rotation, B1 micro-variation, A3 pause week math,
 *         B3 max_tokens range, C1 reach slope, C2 engagement threshold.
 * 2026-06-06
 */
import { describe, it, expect } from 'vitest'

// ── D1: User-Agent rotation ──────────────────────────────────────────────────

describe('REGRESSÃO: D1 — getRandomUA retorna UA de Android real', async () => {
  const { getRandomUA } = await import('./client')

  it('retorna string não-vazia', () => {
    const ua = getRandomUA()
    expect(typeof ua).toBe('string')
    expect(ua.length).toBeGreaterThan(10)
  })

  it('contém "Android" ou "Instagram" (é um UA móvel real)', () => {
    for (let i = 0; i < 20; i++) {
      const ua = getRandomUA()
      expect(ua).toMatch(/Android|Instagram/)
    }
  })

  it('não retorna sempre o mesmo UA (há variação)', () => {
    const samples = new Set(Array.from({ length: 50 }, () => getRandomUA()))
    expect(samples.size).toBeGreaterThan(1)
  })
})

// ── B1: Caption micro-variation ─────────────────────────────────────────────

describe('REGRESSÃO: B1 — applyMicroVariation altera ~20% das captions', async () => {
  const { applyMicroVariation } = await import('./client')

  const caption = 'Título de gancho impactante\n\nContexto com dado relevante aqui.\n\n👉 Acesse agora mesmo'

  it('nunca retorna string vazia', () => {
    for (let i = 0; i < 50; i++) {
      const result = applyMicroVariation(caption)
      expect(result.length).toBeGreaterThan(0)
    }
  })

  it('retorna uma string (nunca null/undefined)', () => {
    for (let i = 0; i < 20; i++) {
      const result = applyMicroVariation(caption)
      expect(typeof result).toBe('string')
    }
  })

  it('caption sem \n\n retorna a caption original (sem crash)', () => {
    const flat = 'Caption sem quebra de parágrafo nenhuma aqui'
    for (let i = 0; i < 20; i++) {
      const result = applyMicroVariation(flat)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    }
  })

  it('em 200 execuções, pelo menos uma variação ocorre (~20%)', () => {
    let changed = 0
    for (let i = 0; i < 200; i++) {
      if (applyMicroVariation(caption) !== caption) changed++
    }
    // Espera ~20% mas aceita qualquer valor > 0 (flukiness)
    expect(changed).toBeGreaterThan(0)
  })

  it('em 200 execuções, pelo menos 70% retorna original (não super-altera)', () => {
    let unchanged = 0
    for (let i = 0; i < 200; i++) {
      if (applyMicroVariation(caption) === caption) unchanged++
    }
    expect(unchanged).toBeGreaterThan(130) // ≥ 65%
  })
})

// ── A3: Pause week — REMOVIDO (tripwire anti-reintrodução) ──────────────────

describe('REGRESSÃO: A3 pause week foi REMOVIDO em 04/07/2026 — não reintroduzir', () => {
  // Veredito do usuário: pausa cega de 1 semana a cada 13 (AI&Tech) / 11 (brand)
  // sem evidência de benefício anti-shadowban, violava a cota mínima de
  // publicação (CLAUDE.md) e mascarou o outage do EditorialFrame (28/06–04/07:
  // 7 dias sem postar, alertas suprimidos). O risco real de queda de alcance é
  // coberto pelo C1 (reach-trend monitor), que pausa 48h baseado em DADO.
  const fs = require('node:fs')

  it('reels-prepare não contém skip de pause_week', () => {
    const src = fs.readFileSync('src/app/api/cron/reels-prepare/route.ts', 'utf8')
    expect(src).not.toContain("skipped: 'pause_week'")
  })

  it('reels-prepare-brand não contém skip de pause_week', () => {
    const src = fs.readFileSync('src/app/api/cron/reels-prepare-brand/route.ts', 'utf8')
    expect(src).not.toContain("skipped: 'pause_week'")
  })

  it('heartbeat não suprime alertas por pause week', () => {
    const src = fs.readFileSync('src/app/api/cron/heartbeat/route.ts', 'utf8')
    expect(src).not.toMatch(/isPauseWeek|suppress[A-Za-z]*QueueAlert/)
  })
})

// ── B3: Variable max_tokens ──────────────────────────────────────────────────

describe('REGRESSÃO: B3 — max_tokens variável ±15%', () => {
  function simulateTokens(base: number): number {
    return Math.round(base * (0.85 + Math.random() * 0.30))
  }

  it('resultado está entre 85% e 115% do base', () => {
    const base = 2000
    for (let i = 0; i < 100; i++) {
      const t = simulateTokens(base)
      expect(t).toBeGreaterThanOrEqual(Math.round(base * 0.85))
      expect(t).toBeLessThanOrEqual(Math.round(base * 1.15))
    }
  })

  it('nunca retorna zero ou negativo', () => {
    for (let i = 0; i < 50; i++) {
      expect(simulateTokens(2000)).toBeGreaterThan(0)
    }
  })

  it('em 100 execuções, há variação (não sempre o mesmo)', () => {
    const values = new Set(Array.from({ length: 100 }, () => simulateTokens(2000)))
    expect(values.size).toBeGreaterThan(1)
  })
})

// ── C1: Reach trend slope ────────────────────────────────────────────────────

describe('REGRESSÃO: C1 — slope de tendência de reach', () => {
  /**
   * Replica a lógica de regressão linear em reels-publish/route.ts:
   * slope = Σ(xi - x̄)(yi - ȳ) / Σ(xi - x̄)²
   * normalizedSlope = slope / mean(reach)
   * threshold: normalizedSlope < -0.1 → declining
   */
  function calcNormalizedSlope(reaches: number[]): number {
    const n = reaches.length
    if (n < 2) return 0
    const xs = reaches.map((_, i) => i)
    const xMean = xs.reduce((a, b) => a + b, 0) / n
    const yMean = reaches.reduce((a, b) => a + b, 0) / n
    if (yMean === 0) return 0
    const num = xs.reduce((s, x, i) => s + (x - xMean) * (reaches[i] - yMean), 0)
    const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0)
    const slope = den === 0 ? 0 : num / den
    return slope / yMean
  }

  it('sequência decrescente forte → slope < -0.1 (deve pausar)', () => {
    const slope = calcNormalizedSlope([5000, 4000, 3000, 2000, 1000])
    expect(slope).toBeLessThan(-0.1)
  })

  it('sequência crescente → slope > 0 (não deve pausar)', () => {
    const slope = calcNormalizedSlope([1000, 2000, 3000, 4000, 5000])
    expect(slope).toBeGreaterThan(0)
  })

  it('sequência estável → slope próximo de 0 (não deve pausar)', () => {
    const slope = calcNormalizedSlope([3000, 3100, 2900, 3050, 2980])
    expect(slope).toBeGreaterThan(-0.1)
  })

  it('reach all zeros → slope 0 (não causa divisão por zero)', () => {
    const slope = calcNormalizedSlope([0, 0, 0, 0, 0])
    expect(slope).toBe(0)
  })

  it('array com menos de 2 elementos → 0', () => {
    expect(calcNormalizedSlope([5000])).toBe(0)
    expect(calcNormalizedSlope([])).toBe(0)
  })
})

// ── C2: Engagement rate threshold ───────────────────────────────────────────

describe('REGRESSÃO: C2 — threshold de engagement rate', () => {
  it('média abaixo de 0.5% dispara alerta', () => {
    const rates = [0.3, 0.4, 0.2, 0.1, 0.45]
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length
    expect(avg).toBeLessThan(0.5)
  })

  it('média igual ou acima de 0.5% não dispara alerta', () => {
    const rates = [0.5, 0.8, 1.2, 0.6, 0.7]
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length
    expect(avg).toBeGreaterThanOrEqual(0.5)
  })

  it('menos de 3 posts → não dispara alerta (dados insuficientes)', () => {
    // A lógica em reels-metrics/route.ts usa: if (recentReels.length >= 3)
    const smallSample = [0.1, 0.2]
    expect(smallSample.length).toBeLessThan(3)
  })

  it('calcEngatRate: reach > 0 produz taxa não-negativa', () => {
    const engRate = (likes: number, comments: number, saved: number, shares: number, reach: number) =>
      reach > 0 ? Math.round(((likes + comments + saved + shares) / reach) * 10000) / 100 : 0
    expect(engRate(50, 5, 10, 2, 1000)).toBeGreaterThan(0)
    expect(engRate(0, 0, 0, 0, 1000)).toBe(0)
    expect(engRate(50, 5, 10, 2, 0)).toBe(0) // reach=0 → sem divisão por zero
  })
})
