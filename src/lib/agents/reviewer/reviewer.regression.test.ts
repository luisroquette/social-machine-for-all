/**
 * REGRESSÃO: Reviewer com pesos configuráveis (Camada 3 do auto-aprendizado).
 *
 * O Reviewer pondera 6 dimensões (hook, insight, voice, size, identity, politics)
 * com pesos lidos de workspace_settings. Estes testes blindam:
 *  1. Os defaults das 6 dimensões somam exatamente 1.0 (um peso editado sem
 *     rebalancear quebraria o score silenciosamente).
 *  2. As 6 keys de peso existem nas definições.
 *  3. O Reviewer REALMENTE lê os pesos do settings (não hardcoded) e computa
 *     o overall como soma ponderada, com threshold configurável.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { VARIABLE_DEFINITIONS } from '../../settings/load-settings'

const WEIGHT_KEYS = [
  'reviewer_weight_hook',
  'reviewer_weight_insight',
  'reviewer_weight_voice',
  'reviewer_weight_size',
  'reviewer_weight_identity',
  'reviewer_weight_politics',
] as const

const SRC = readFileSync(join(process.cwd(), 'src/lib/agents/reviewer/index.ts'), 'utf-8')

describe('REGRESSÃO: pesos default do Reviewer', () => {
  it('as 6 dimensões existem nas definições', () => {
    for (const key of WEIGHT_KEYS) {
      expect(VARIABLE_DEFINITIONS.find(d => d.key === key), `falta ${key}`).toBeDefined()
    }
  })

  it('os defaults somam exatamente 1.0', () => {
    const sum = WEIGHT_KEYS.reduce((acc, key) => {
      const def = VARIABLE_DEFINITIONS.find(d => d.key === key)!
      return acc + Number(def.defaultValue)
    }, 0)
    expect(Math.round(sum * 1000) / 1000).toBe(1.0)
  })
})

describe('REGRESSÃO: Reviewer lê pesos do settings e pondera', () => {
  it('carrega as 6 dimensões via getNumericVariable (não hardcoded)', () => {
    for (const key of WEIGHT_KEYS) {
      expect(SRC).toContain(`getNumericVariable(ctx.workspaceId, '${key}')`)
    }
  })

  it('computa o overall como soma ponderada (score * weight)', () => {
    expect(SRC).toMatch(/reduce\(\(sum,\s*\[dim,\s*weight\]\)/)
    expect(SRC).toMatch(/sum\s*\+\s*score\s*\*\s*weight/)
  })

  it('threshold de aprovação vem do settings, com normalização 0-100→0-10', () => {
    expect(SRC).toMatch(/reviewer_approval_threshold/)
    expect(SRC).toMatch(/approvalThreshold\s*>\s*10/)
    expect(SRC).toMatch(/roundedOverall\s*>=\s*approvalThreshold/)
  })
})

describe('REGRESSÃO: quality gate editorial bloqueante', () => {
  it('compara o draft com a fonte original', () => {
    expect(SRC).toContain(".from('curated_content')")
    expect(SRC).toContain('Fonte original para verificacao factual')
  })

  it('bloqueia somente falhas críticas e trata notas limítrofes como melhoria', () => {
    expect(SRC).toContain('critical_checks')
    expect(SRC).toContain('promise_delivery')
    expect(SRC).toContain('hardMinimums')
    expect(SRC).toContain('Melhoria recomendada')
  })

  it('não inventa reprovação de correlação quando a fonte não existe', () => {
    expect(SRC).toContain('correlation: hasSource ?')
    expect(SRC).toContain(': null')
  })

  it('separa bloqueios editoriais de melhorias opcionais', () => {
    expect(SRC).toContain('blocking_issues')
    expect(SRC).toContain('improvements')
    expect(SRC).toContain('blockingIssues.length > 0')
    expect(SRC).toContain('editorial_quality_review')
  })

  it('executa o gate estrutural antes da chamada ao modelo', () => {
    expect(SRC.indexOf('runQualityGate(draft.content')).toBeLessThan(SRC.indexOf('generateSimpleText({'))
  })
})
