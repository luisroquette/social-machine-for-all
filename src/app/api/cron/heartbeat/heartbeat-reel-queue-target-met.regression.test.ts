/**
 * REGRESSÃO: heartbeat — "fila reel_ready vazia" não deve alarmar quando a
 * meta do dia já foi batida
 *
 * Achado em 2026-07-10: às 14:30 BRT o @brand já tinha publicado 2/2 reels
 * do dia (min_reels_per_day=1, target_reels_per_day=2), mas o alerta "fila
 * reel_ready VAZIA — nenhum reel será publicado" disparou mesmo assim, porque
 * o check só olhava se havia algo na fila AGORA, sem considerar se a meta do
 * dia já tinha sido cumprida.
 *
 * Fix: suprimir esse alerta especificamente quando publishedHoje >= target
 * (evidência real de entrega, não suposição de calendário — diferente da
 * supressão "pause week" removida em 04/07/2026 que mascarou o outage do
 * DoomGuyFrame). Se o target não está configurado (0/ausente), o guard nunca
 * satisfaz e o alerta continua dependendo só da fila vazia como sempre foi —
 * sem regressão para workspaces sem essa config (ex: AI & Tech hoje).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const FILE = join(__dirname, 'route.ts')
const src = readFileSync(FILE, 'utf-8')

describe('REGRESSÃO: reel_ready vazio não alarma se a meta do dia já foi batida', () => {
  it('target_reels_per_day é lido via getNumericVariable pros dois workspaces', () => {
    expect(src).toContain("getNumericVariable(WORKSPACE_ID, 'target_reels_per_day')")
    expect(src).toContain("getNumericVariable(brandMOB_WS, 'target_reels_per_day')")
  })

  it('o guard de meta batida exige target > 0 (config ausente nunca suprime o alerta)', () => {
    expect(src).toMatch(/targetReelsAiTech\s*>\s*0\s*&&/)
    expect(src).toMatch(/targetReelsbrand\s*>\s*0\s*&&/)
  })

  it('a condição do alerta de fila vazia (AI&Tech) inclui o guard de meta não batida', () => {
    const line = src.split('\n').find(l => l.includes('reelReadyAiTech') && l.includes('brtHour >= 10'))
    expect(line, 'linha do warning reelReadyAiTech não encontrada').toBeTruthy()
    expect(line).toMatch(/aiTechTargetMet/)
  })

  it('a condição do alerta de fila vazia (Brand) inclui o guard de meta não batida', () => {
    const line = src.split('\n').find(l => l.includes('reelReadybrand') && l.includes('brtHour >= 10'))
    expect(line, 'linha do warning reelReadybrand não encontrada').toBeTruthy()
    expect(line).toMatch(/brandTargetMet/)
  })
})
