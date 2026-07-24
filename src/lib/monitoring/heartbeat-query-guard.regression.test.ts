/**
 * REGRESSÃO: heartbeat engolia erros de query do Supabase (padrão do incidente 42703)
 *
 * Incidente 04/07/2026: o watchdog de 'publishing' consultava generated_content.updated_at,
 * coluna que não existia. O erro 42703 do Postgres NÃO lança exceção no supabase-js —
 * volta em `{ data: null, error: {...} }`. Como o heartbeat destructurava só `{ data }` /
 * `{ count }` (com casts `as { count: number | null }`), o null fluía pelos `?? 0`,
 * nenhum warning disparava, e o watchdog ficou CEGO por 16 dias sem ninguém saber.
 *
 * O fix da época (migration 019) criou a coluna — mas protegeu só aquela coluna.
 * Este fix fecha a CLASSE do bug: toda query de monitoramento do heartbeat passa por
 * guardCount/guardData, que coletam o erro; qualquer falha vira warning 🔴 no Telegram
 * (código 'heartbeat_query_error') + Sentry. Um watchdog que falha deve ALERTAR,
 * nunca retornar null em silêncio.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { createDbErrorCollector, guardCount, guardData } from './heartbeat-query-guard'

// ── Comportamento do guard (unidade, puro) ───────────────────────────────────

describe('REGRESSÃO 42703: guard de query coleta erro em vez de engolir', () => {
  it('guardCount com erro 42703 registra a falha e devolve null', () => {
    const collector = createDbErrorCollector()
    const res = guardCount(collector, 'stuck_publishing', {
      count: null,
      error: { message: 'column generated_content.updated_at does not exist', code: '42703' },
    })
    expect(res).toBeNull()
    expect(collector.failures).toHaveLength(1)
    expect(collector.failures[0]).toContain('stuck_publishing')
    expect(collector.failures[0]).toContain('42703')
  })

  it('guardData com erro registra a falha e devolve null', () => {
    const collector = createDbErrorCollector()
    const res = guardData(collector, 'stuck_pipelines', {
      data: null,
      error: { message: 'relation "pipeline_runs" does not exist', code: '42P01' },
    })
    expect(res).toBeNull()
    expect(collector.failures).toHaveLength(1)
    expect(collector.failures[0]).toContain('stuck_pipelines')
  })

  it('sem erro, os valores passam intactos e nada é coletado', () => {
    const collector = createDbErrorCollector()
    expect(guardCount(collector, 'a', { count: 7, error: null })).toBe(7)
    expect(guardCount(collector, 'b', { count: 0, error: null })).toBe(0)
    expect(guardData(collector, 'c', { data: [{ id: 'x' }], error: null })).toEqual([{ id: 'x' }])
    expect(collector.failures).toHaveLength(0)
  })

  it('múltiplas falhas acumulam no mesmo collector', () => {
    const collector = createDbErrorCollector()
    guardCount(collector, 'q1', { count: null, error: { message: 'boom' } })
    guardData(collector, 'q2', { data: null, error: { message: 'boom2' } })
    expect(collector.failures).toHaveLength(2)
  })
})

// ── Fiação no heartbeat (inspeção de fonte) ──────────────────────────────────

const routeSrc = readFileSync(join(__dirname, '../../app/api/cron/heartbeat/route.ts'), 'utf-8')

describe('REGRESSÃO 42703: heartbeat não pode voltar a engolir erros de query', () => {
  it('nenhum cast cru `as { count: number | null }` sobrou no heartbeat (era o swallow)', () => {
    expect(routeSrc).not.toMatch(/as \{ count: number \| null \}/)
  })

  it('nenhum cast cru `as { data: ... }` de query sobrou no heartbeat', () => {
    expect(routeSrc).not.toMatch(/as \{ data: \{ id: string/)
  })

  it('heartbeat usa o guard e cria o collector', () => {
    expect(routeSrc).toContain('createDbErrorCollector()')
    expect(routeSrc).toMatch(/guardCount\(/)
    expect(routeSrc).toMatch(/guardData[<(]/)
  })

  it('falha de query vira warning crítico com código estável heartbeat_query_error', () => {
    expect(routeSrc).toContain("warningCodes.push('heartbeat_query_error')")
    // O texto do warning deve ser 🔴 (crítico → dispara email além do Telegram)
    const idx = routeSrc.indexOf("warningCodes.push('heartbeat_query_error')")
    const before = routeSrc.slice(Math.max(0, idx - 400), idx)
    expect(before).toContain('🔴')
  })

  it('falha de query também vai pro Sentry (não só Telegram)', () => {
    const idx = routeSrc.indexOf("warningCodes.push('heartbeat_query_error')")
    const context = routeSrc.slice(Math.max(0, idx - 800), idx + 200)
    expect(context).toMatch(/Sentry\.capture/)
  })
})
