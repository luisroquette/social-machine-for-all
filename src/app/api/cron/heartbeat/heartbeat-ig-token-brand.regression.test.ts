/**
 * REGRESSÃO: heartbeat — token do Instagram do Brand também é checado
 *
 * Achado em 2026-07-11 (mesma revisão que achou o vazamento de workspace em
 * agent_actions): o heartbeat já monitora reel_ready/failed/published do
 * Brand, mas o health-check de token do Instagram só cobria o AI & Tech
 * (getInstagramCredentials(WORKSPACE_ID)) — o @brand tem conta e token
 * próprios (brandMOB_WS) e nunca eram checados. Se o token do Brand
 * expirasse, ninguém seria avisado.
 *
 * Fix: mesmo check, espelhado pro brandMOB_WS — mesma lógica de host
 * IGAA/EAA e mesma regra de só marcar expirado em 400/401 (nunca em falha
 * transitória de rede).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const FILE = join(__dirname, 'route.ts')
const src = readFileSync(FILE, 'utf-8')

describe('REGRESSÃO: Instagram token do Brand é checado no heartbeat', () => {
  it('getInstagramCredentials é chamado também com brandMOB_WS', () => {
    expect(src).toContain('getInstagramCredentials(brandMOB_WS)')
  })

  it('só marca expirado em 400/401, nunca em falha transitória (mesma regra do check original)', () => {
    const idx = src.indexOf('getInstagramCredentials(brandMOB_WS)')
    const block = src.slice(idx, idx + 500)
    expect(block).toMatch(/status === 400 \|\| \w+\.status === 401/)
  })

  it('gera um warning e warningCode próprios pro Brand quando expira', () => {
    expect(src).toContain("warningCodes.push('ig_token_expired_brand')")
    const idx = src.indexOf("warningCodes.push('ig_token_expired_brand')")
    const block = src.slice(Math.max(0, idx - 200), idx)
    expect(block).toContain('@brand')
  })
})
