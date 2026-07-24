/**
 * REGRESSÃO: todo fetch() em reels-metrics, reels-metrics-brand e sync-ads tem
 * AbortSignal.timeout (auditoria contínua /loop, 2026-07-15).
 *
 * Estes crons fazem loop sobre múltiplos reels/campanhas/contas, cada iteração chamando
 * a API do Instagram ou do Facebook Ads sem NENHUM timeout — um único fetch travado
 * bloqueava o loop inteiro (e, por consequência, os itens seguintes) até o maxDuration
 * da função matar o processo.
 *
 * Mesmo parser genérico usado em client-fetch-timeouts.regression.test.ts: localiza cada
 * `fetch(` e o parêntese de fechamento correspondente (contagem balanceada), exige
 * `signal:` dentro desse span.
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

describe('REGRESSÃO: fetch() em loops de métricas/ads tem timeout explícito (bug 2026-07-15)', () => {
  it('reels-metrics: todo fetch (Telegram, IG insights, IG stories) tem timeout', () => {
    assertAllFetchesHaveTimeout('src/app/api/cron/reels-metrics/route.ts', 4)
  })

  it('reels-metrics-brand: todo fetch (Telegram, IG insights) tem timeout', () => {
    assertAllFetchesHaveTimeout('src/app/api/cron/reels-metrics-brand/route.ts', 2)
  })

  it('sync-ads: todo fetch (campanhas, insights) tem timeout', () => {
    assertAllFetchesHaveTimeout('src/app/api/cron/sync-ads/route.ts', 2)
  })
})
