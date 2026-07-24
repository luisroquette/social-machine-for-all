/**
 * REGRESSÃO: todo fetch() em heartbeat e scheduler tem AbortSignal.timeout
 * (auditoria contínua /loop, 2026-07-15).
 *
 * heartbeat: 2 checks de token do Instagram (@ai_br_videos + @brand) e 1 alerta
 * Telegram sem NENHUM timeout. O alerta Telegram também não tinha try/catch — um
 * timeout adicionado sem isso lançaria uma exceção não capturada, derrubando o health
 * check inteiro (pior que travar). Ambos corrigidos juntos.
 *
 * scheduler: runInternalCron (dispara os crons do pipeline de trend, sequencialmente,
 * aguardado) sem timeout — um cron travado bloqueava todos os seguintes e podia
 * consumir o próprio maxDuration=300 do scheduler.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

function findFetchCallSpans(src: string): Array<{ start: number; text: string }> {
  const spans: Array<{ start: number; text: string }> = []
  const re = /\bfetch\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(src)) !== null) {
    const start = match.index
    let depth = 0
    let i = match.index + 'fetch('.length - 1
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    spans.push({ start, text: src.slice(start, i + 1) })
  }
  return spans
}

function assertAllFetchesHaveTimeout(filePath: string, minExpected: number) {
  const src = readFileSync(join(process.cwd(), filePath), 'utf-8')
  const spans = findFetchCallSpans(src)
  expect(spans.length).toBeGreaterThanOrEqual(minExpected)
  const missing = spans.filter((s) => !s.text.includes('signal:'))
  if (missing.length) {
    const lineNumbers = missing.map((s) => src.slice(0, s.start).split('\n').length)
    throw new Error(`${filePath}: fetch() sem timeout nas linhas ${lineNumbers.join(', ')}`)
  }
}

describe('REGRESSÃO: fetch() em heartbeat e scheduler tem timeout explícito (bug 2026-07-15)', () => {
  it('heartbeat: checks de token IG e alerta Telegram têm timeout', () => {
    assertAllFetchesHaveTimeout('src/app/api/cron/heartbeat/route.ts', 3)
  })

  it('heartbeat: alerta Telegram tem try/catch (best-effort, não pode derrubar o health check)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/cron/heartbeat/route.ts'), 'utf-8')
    const block = src.slice(src.indexOf('// ── Telegram ──'), src.indexOf('// ── Email'))
    expect(block).toContain('try {')
    expect(block).toContain('catch (err)')
  })

  it('scheduler: runInternalCron e o dispatch de agentes via waitUntil têm timeout', () => {
    assertAllFetchesHaveTimeout('src/app/api/cron/scheduler/route.ts', 2)
  })
})
