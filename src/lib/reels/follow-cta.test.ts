/**
 * REGRESSÃO: ângulo de follow-CTA rotativo (conversão view->follow — 16/06/2026)
 *
 * A caption fechava sempre com o mesmo boilerplate "Siga @x pra mais conteudo".
 * pickFollowCtaAngle dá uma razão concreta pra seguir e alterna entre as facetas
 * da identidade (digest/insider/série/profundidade/curadoria), evitando fingerprint
 * repetido e permitindo descobrir qual ângulo converte.
 */

import { describe, it, expect } from 'vitest'
import { FOLLOW_CTA_ANGLES, pickFollowCtaAngle } from './follow-cta'

describe('pickFollowCtaAngle', () => {
  it('sempre retorna um ângulo válido com key e texto', () => {
    const a = pickFollowCtaAngle()
    expect(FOLLOW_CTA_ANGLES.some((x) => x.key === a.key)).toBe(true)
    expect(a.angle.length).toBeGreaterThan(20)
  })

  it('rng injetável escolhe deterministicamente (rotação)', () => {
    expect(pickFollowCtaAngle(() => 0).key).toBe(FOLLOW_CTA_ANGLES[0].key)
    expect(pickFollowCtaAngle(() => 0.999).key).toBe(FOLLOW_CTA_ANGLES[FOLLOW_CTA_ANGLES.length - 1].key)
  })

  it('cobre as 3 facetas da identidade aprovada (digest, insider, série)', () => {
    const keys = FOLLOW_CTA_ANGLES.map((a) => a.key)
    expect(keys).toContain('digest')
    expect(keys).toContain('insider')
    expect(keys).toContain('serie')
  })

  it('nenhum ângulo usa o boilerplate genérico "mais conteudo"', () => {
    for (const a of FOLLOW_CTA_ANGLES) {
      expect(/mais conte[úu]do sobre ia/i.test(a.angle)).toBe(false)
    }
  })
})
