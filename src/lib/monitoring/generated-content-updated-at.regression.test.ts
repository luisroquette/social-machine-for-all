/**
 * REGRESSÃO: generated_content.updated_at DEVE existir no schema (migration + trigger).
 *
 * Bug histórico (18/06–04/07/2026): o watchdog de "reel preso em publishing"
 * (heartbeat/route.ts) e o auto-unstick do publisher (publisher/index.ts)
 * consultam `generated_content.updated_at` — mas a tabela foi criada SEM essa
 * coluna (migration 003). O PostgREST retornava erro 42703, o código descartava
 * o erro silenciosamente (`data` null / lista vazia), e 4 reels do Brand
 * ficaram órfãos em 'publishing' por até 16 dias sem nenhum alerta.
 *
 * Este teste quebra o build se:
 *  - a migration que cria a coluna + trigger for removida, OU
 *  - alguém voltar a consultar updated_at sem schema por trás.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const MIGRATIONS_DIR = join(__dirname, '../../../supabase/migrations')

function allMigrationsSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n')
}

describe('REGRESSÃO: coluna updated_at em generated_content (watchdog de publishing)', () => {
  it('alguma migration adiciona updated_at a generated_content', () => {
    const sql = allMigrationsSql()
    expect(sql).toMatch(
      /ALTER TABLE (public\.)?generated_content\s+ADD COLUMN IF NOT EXISTS updated_at/i
    )
  })

  it('alguma migration cria trigger que mantém updated_at fresco em UPDATE', () => {
    const sql = allMigrationsSql()
    expect(sql).toMatch(/CREATE TRIGGER \S*updated_at\S*\s+BEFORE UPDATE ON (public\.)?generated_content/i)
  })

  it('heartbeat continua usando updated_at no check de stuck publishing', () => {
    const src = readFileSync(join(__dirname, '../../app/api/cron/heartbeat/route.ts'), 'utf8')
    expect(src).toContain(".lt('updated_at'")
  })

  it('publisher continua usando updated_at no auto-unstick', () => {
    const src = readFileSync(join(__dirname, '../../lib/agents/publisher/index.ts'), 'utf8')
    expect(src).toContain(".lt('updated_at'")
  })
})
