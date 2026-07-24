/**
 * REGRESSÃO: todo fetch() em ads-strategist e editor-in-chief tem AbortSignal.timeout
 * (auditoria contínua /loop, 2026-07-15).
 *
 * ads-strategist: loop por conta/campanha do Meta Ads sem timeout (mesmo padrão de
 * sync-ads/route.ts). editor-in-chief: 3 chamadas de dispatch para outros agentes
 * (publisher/run, agents/[slug]/run, pipeline/run) sem NENHUM timeout — duas são
 * comandos via Telegram que aguardam o resultado (timeout generoso mas limitado), uma é
 * um disparo autônomo best-effort (timeout mais curto, não deve consumir o próprio
 * orçamento de editor-in-chief esperando outro agente terminar).
 *
 * Mesmo parser genérico usado em client-fetch-timeouts.regression.test.ts.
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

describe('REGRESSÃO: fetch() em agentes tem timeout explícito (bug 2026-07-15)', () => {
  it('ads-strategist: fetch de campanhas e insights do Meta Ads tem timeout', () => {
    assertAllFetchesHaveTimeout('src/lib/agents/ads-strategist/index.ts', 2)
  })

  it('editor-in-chief: dispatch para publisher/run, agents/[slug]/run e pipeline/run tem timeout', () => {
    assertAllFetchesHaveTimeout('src/lib/agents/editor-in-chief/index.ts', 3)
  })
})
