/**
 * REGRESSÃO: TODO fetch() em client.ts tem AbortSignal.timeout (auditoria 2026-07-15).
 *
 * Este arquivo teve, ao longo de uma única auditoria, 15 chamadas a `fetch()` espalhadas
 * por 6 métodos de publish diferentes (publishImage, publishCarousel, publishMixedCarousel,
 * publishReel, waitForContainer, fetchPermalink, shareToStories, postComment) — 12 delas
 * sem NENHUM timeout, descobertas uma de cada vez conforme cada método era auditado.
 *
 * Em vez de travar cada uma individualmente (frágil — um método novo escapa da cobertura),
 * este teste faz parsing genérico: para cada `fetch(` no arquivo, encontra o parêntese de
 * fechamento correspondente (contagem balanceada) e verifica que `signal:` aparece dentro
 * desse span. Qualquer fetch novo adicionado no futuro sem timeout quebra este teste.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = readFileSync(join(process.cwd(), 'src/lib/platforms/instagram/client.ts'), 'utf-8')

/** Retorna o span de texto de cada chamada `fetch(...)`, do `fetch(` até o `)` de fechamento correspondente. */
function findFetchCallSpans(src: string): Array<{ start: number; end: number; text: string }> {
  const spans: Array<{ start: number; end: number; text: string }> = []
  const re = /\bfetch\(/g
  let match: RegExpExecArray | null
  while ((match = re.exec(src)) !== null) {
    const start = match.index
    let depth = 0
    let i = match.index + 'fetch('.length - 1 // position of the opening '('
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')') {
        depth--
        if (depth === 0) break
      }
    }
    spans.push({ start, end: i + 1, text: src.slice(start, i + 1) })
  }
  return spans
}

describe('REGRESSÃO: todo fetch() em client.ts tem AbortSignal.timeout (auditoria 2026-07-15)', () => {
  it('encontra pelo menos 15 chamadas fetch() — se esse número cair, o parser quebrou, não o código', () => {
    const spans = findFetchCallSpans(SRC)
    expect(spans.length).toBeGreaterThanOrEqual(15)
  })

  it('toda chamada fetch() tem `signal:` dentro do seu próprio escopo de argumentos', () => {
    const spans = findFetchCallSpans(SRC)
    const missing = spans.filter((s) => !s.text.includes('signal:'))
    if (missing.length) {
      const lineNumbers = missing.map((s) => SRC.slice(0, s.start).split('\n').length)
      throw new Error(`fetch() sem timeout nas linhas: ${lineNumbers.join(', ')}\n\n${missing.map(s => s.text).join('\n---\n')}`)
    }
    expect(missing).toHaveLength(0)
  })
})
