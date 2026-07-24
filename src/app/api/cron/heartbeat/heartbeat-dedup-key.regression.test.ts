/**
 * REGRESSÃO: heartbeat — chave de dedup do Telegram deve ser estável
 *
 * Achado na auditoria de 2026-07-10: o dedup (Telegram + gate `sameWarnings &&
 * recentAlert`) usava `warnings.join('|')` como chave — mas várias mensagens
 * embutem contadores/IDs voláteis (ex: "5/10 reels hoje", IDs de
 * stuckPublishing, noCoverCount). Isso faz a chave mudar quase todo run,
 * derrotando o dedup na prática: o Telegram spamma a cada 15 min mesmo com a
 * mesma causa raiz não resolvida.
 *
 * Fix: `warningCodes` (códigos estáveis, sem contadores/IDs) é a chave real
 * de dedup; `warnings` (texto formatado, com números) continua sendo o que é
 * de fato enviado pro Telegram/email.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const FILE = join(__dirname, 'route.ts')
const src = readFileSync(FILE, 'utf-8')

describe('REGRESSÃO: heartbeat — dedup key estável (warningCodes, não warnings)', () => {
  it('a chave de dedup é derivada de warningCodes, não do texto formatado', () => {
    expect(src).toContain("const currentWarningsKey = warningCodes.join('|')")
    expect(src).not.toMatch(/currentWarningsKey = warnings\.join/)
  })

  it('existe um warningCodes.push() para cada warnings.push() (nenhum aviso fica sem código estável)', () => {
    const pushCount = (re: RegExp) => (src.match(re) ?? []).length
    const warningsPushes = pushCount(/warnings\.push\(/g)
    const codePushes = pushCount(/warningCodes\.push\(/g)
    expect(codePushes, `esperava ${warningsPushes} chamadas de warningCodes.push() (uma por warnings.push()), achei ${codePushes}`).toBe(warningsPushes)
  })

  it('os códigos são estáveis — nenhum deles interpola variáveis (sem ${)', () => {
    const codeLines = src.match(/warningCodes\.push\(([^)]*)\)/g) ?? []
    expect(codeLines.length).toBeGreaterThan(0)
    for (const line of codeLines) {
      expect(line, `código de warning não deveria interpolar valores voláteis: ${line}`).not.toContain('${')
    }
  })
})
