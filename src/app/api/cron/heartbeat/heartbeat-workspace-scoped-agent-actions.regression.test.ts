/**
 * REGRESSÃO: heartbeat (AI & Tech) — queries de agent_actions escopadas por workspace
 *
 * Achado em 2026-07-11 (durante trace de grafo de conhecimento da sessão):
 * este heartbeat é especificamente o canal AI & Tech (carrega telegram_group_id
 * do WORKSPACE_ID pra decidir pra onde mandar o alerta), mas 3 queries de
 * agent_actions não filtravam por workspace_id — misturando dados de AI & Tech
 * e Brand no mesmo número. Confirmado como bug ATIVO (não latente): os dois
 * workspaces tinham atividade real em agent_actions nas últimas 24h no momento
 * do achado (Brand 11 linhas, AI & Tech 216).
 *
 * Outras queries no mesmo arquivo já filtravam corretamente (stuckCuratorRuns,
 * publisherCreditErrors via generated_content) — confirma que era inconsistência,
 * não uma tabela intencionalmente global.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const FILE = join(__dirname, 'route.ts')
const src = readFileSync(FILE, 'utf-8')

function queryBlock(marker: string): string {
  const idx = src.indexOf(marker)
  expect(idx, `marcador "${marker}" não encontrado em route.ts`).toBeGreaterThan(-1)
  return src.slice(idx, idx + 360)
}

describe('REGRESSÃO: queries de agent_actions no heartbeat AI & Tech são escopadas por workspace_id', () => {
  it('recentErrors (High error rate) filtra por workspace_id', () => {
    const block = queryBlock("const recentErrors = guardCount(dbGuard, 'agent_actions.recent_errors', await supabase")
    expect(block, 'recentErrors mistura erros de todos os workspaces').toContain("eq('workspace_id', WORKSPACE_ID)")
  })

  it('twitterCreditErrors filtra por workspace_id', () => {
    const block = queryBlock("const twitterCreditErrors = guardCount(dbGuard, 'agent_actions.twitter_credit_errors', await supabase")
    expect(block, 'twitterCreditErrors mistura créditos de todos os workspaces').toContain("eq('workspace_id', WORKSPACE_ID)")
  })

  it('anthropicCreditErrors filtra por workspace_id', () => {
    const block = queryBlock("const anthropicCreditErrors = guardCount(dbGuard, 'agent_actions.anthropic_credit_errors', await supabase")
    expect(block, 'anthropicCreditErrors mistura créditos de todos os workspaces').toContain("eq('workspace_id', WORKSPACE_ID)")
  })
})
