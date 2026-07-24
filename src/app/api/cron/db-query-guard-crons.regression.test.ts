/**
 * REGRESSÃO GLOBAL: nenhum cron pode engolir erro de query do Supabase
 *
 * Classe do incidente 42703 (jun-jul/2026): erros do Postgres não lançam
 * exceção no supabase-js — voltam em `{ data: null, count: null, error }`.
 * O padrão `as { count: number | null }` descartava o campo error no cast e
 * o null fluía pelos `?? 0`: scheduler achava que não havia jobs, quotas de
 * reels liam 0 produzidos, daily-report reportava zeros — tudo sem alerta.
 *
 * Este teste quebra o build se o swallow-cast voltar a QUALQUER cron.
 * (O heartbeat tem cobertura própria em heartbeat-query-guard.regression.test.ts.)
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

const CRON_DIR = join(__dirname)

function walkRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkRouteFiles(full))
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

describe('REGRESSÃO 42703: crons não engolem erro de query', () => {
  const files = walkRouteFiles(CRON_DIR)

  it('encontrou os crons (sanidade do walker)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files.map(f => [f.replace(CRON_DIR, 'cron'), f]))(
    '%s: sem cast `as { count: number | null }` (swallow de erro)',
    (_label, file) => {
      const src = readFileSync(file, 'utf-8')
      expect(src, `${file} reintroduziu o swallow-cast — use destructure com error + Sentry (guard 42703)`)
        .not.toContain('as { count: number | null }')
    },
  )

  it('crons com guard reportam falha via Sentry com step db_query_guard', () => {
    const guarded = ['scheduler', 'reels-prepare', 'reels-prepare-brand', 'daily-report', 'trend-video-publish', 'trend-creative-prepare']
    for (const cron of guarded) {
      const src = readFileSync(join(CRON_DIR, cron, 'route.ts'), 'utf-8')
      expect(src, `${cron} perdeu o guard de query (step db_query_guard)`).toContain("step: 'db_query_guard'")
    }
  })
})
