/**
 * REGRESSÃO 23/07/2026: update de retry/failed após EXCEÇÃO no publish era fire-and-forget
 *
 * Bug: no catch() do execute() do publisher, a transição de status pós-exceção (failed ou
 * de volta pra approved) disparava o update SEM await, com `.then(() => {}, () => {})` —
 * engolindo sucesso E erro. Se o processo terminasse antes do update resolver, ou o update
 * falhasse por qualquer motivo, o item ficava preso em 'publishing' pra sempre, sem retry,
 * sem log, sem sinal nenhum pro Sentinel/Doctor investigarem.
 *
 * Fix: extraído para `finalizeExceptionRetry`, sempre awaitado, com log explícito se o
 * próprio update falhar.
 */
import { describe, it, expect, vi } from 'vitest'
import { finalizeExceptionRetry } from './index'

function makeSupabaseMock(updateResult: { error: { message: string } | null } = { error: null }) {
  const updateCalls: Array<{ payload: unknown; filters: Array<[string, unknown]> }> = []
  const from = vi.fn(() => ({
    update: vi.fn((payload: unknown) => {
      const filters: Array<[string, unknown]> = []
      const chain = {
        eq: vi.fn((col: string, value: unknown) => {
          filters.push([col, value])
          if (filters.length === 2) {
            updateCalls.push({ payload, filters: [...filters] })
            return Promise.resolve(updateResult)
          }
          return chain
        }),
      }
      return chain
    }),
  }))
  return { from, updateCalls }
}

describe('REGRESSÃO: finalizeExceptionRetry — update pós-exceção sempre awaitado', () => {
  it('esgotou as tentativas → marca failed com review_feedback da exceção', async () => {
    const { from, updateCalls } = makeSupabaseMock()
    await finalizeExceptionRetry({ from } as never, 'item-a', 3, 3, false, 'network timeout')

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0].payload).toEqual({
      status: 'failed',
      retry_count: 3,
      review_feedback: 'Failed after 3 attempts (exception): network timeout',
    })
  })

  it('exceção permanente (4xx) → marca failed mesmo com tentativas de sobra', async () => {
    const { from, updateCalls } = makeSupabaseMock()
    await finalizeExceptionRetry({ from } as never, 'item-b', 1, 3, true, '401 unauthorized')

    expect((updateCalls[0].payload as { status: string }).status).toBe('failed')
  })

  it('ainda tem tentativa e não é exceção permanente → devolve pra approved', async () => {
    const { from, updateCalls } = makeSupabaseMock()
    await finalizeExceptionRetry({ from } as never, 'item-c', 1, 3, false, 'temporary glitch')

    expect(updateCalls[0].payload).toEqual({ status: 'approved', retry_count: 1 })
  })

  it('sempre filtra por id E status=publishing (lock otimista preservado)', async () => {
    const { from, updateCalls } = makeSupabaseMock()
    await finalizeExceptionRetry({ from } as never, 'item-d', 1, 3, false, 'x')

    expect(updateCalls[0].filters).toEqual([
      ['id', 'item-d'],
      ['status', 'publishing'],
    ])
  })

  it('o update em si falhando não lança exceção (a chamadora já está dentro de um catch)', async () => {
    const { from } = makeSupabaseMock({ error: { message: 'conexão recusada' } })
    await expect(
      finalizeExceptionRetry({ from } as never, 'item-e', 1, 3, false, 'y')
    ).resolves.toBeUndefined()
  })

  it('resolve a promise ANTES de retornar — nunca dispara e esquece (a regressão original)', async () => {
    let resolveUpdate: (v: { error: null }) => void = () => {}
    const pending = new Promise<{ error: null }>((resolve) => {
      resolveUpdate = resolve
    })
    const from = vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => pending),
        })),
      })),
    }))

    let settled = false
    const call = finalizeExceptionRetry({ from } as never, 'item-f', 1, 3, false, 'z').then(() => {
      settled = true
    })
    // Ainda não resolveu o update simulado — a função não deveria ter retornado ainda.
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveUpdate({ error: null })
    await call
    expect(settled).toBe(true)
  })
})
