import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

describe('REGRESSÃO: reels-prepare — caption AI & Tech mantém trilho narrativo', () => {
  it('instrui stakes, payoff, turn e takeaway sem alterar o schema JSON', () => {
    const routePath = fileURLToPath(new URL('./route.ts', import.meta.url))
    const src = fs.readFileSync(routePath, 'utf8')
    expect(src).toContain('ESTRUTURA NARRATIVA RECOMENDADA')
    expect(src).toContain('STAKES')
    expect(src).toContain('PAYOFF')
    expect(src).toContain('TURN')
    expect(src).toContain('TAKEAWAY')
    expect(src).toContain('Nao escreva labels')
  })
})
