/**
 * REGRESSÃO: itens presos em 'publishing' ficavam órfãos até 16h (bug 2026-07-14)
 *
 * Bug: a lógica de destravar itens presos em 'publishing' >10min só rodava no início do
 * execute() do próprio agente publisher — cujo schedule_cron para o workspace Brand
 * é apenas 3x/dia (11h/15h/19h BRT). Quando o Vercel matava a função no meio do render
 * (Remotion Lambda em paralelo com geração de capa + polling do container do Instagram
 * podem juntos passar de 300s), o item ficava com status='publishing' órfão até o PRÓXIMO
 * ciclo agendado do publisher — até ~16h de espera. @brand ficou com um item preso
 * de 2026-07-13 20:01 até intervenção manual em 2026-07-15.
 *
 * Fix: `unstickPublishingItems` foi extraída para ser chamada também pelo cron scheduler
 * (roda a cada 5 min, para todos os workspaces), independente do schedule_cron de cada
 * agente publisher.
 */

import { describe, it, expect, vi } from 'vitest'
import { unstickPublishingItems } from './index'

function makeSupabaseMock(stuckItems: Array<{ id: string; retry_count: number | null }>) {
  const updateCalls: Array<{ payload: unknown; filter: string; value: unknown }> = []

  const from = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          lt: vi.fn().mockResolvedValue({ data: stuckItems }),
        })),
      })),
    })),
    update: vi.fn((payload: unknown) => ({
      in: vi.fn((col: string, ids: string[]) => {
        updateCalls.push({ payload, filter: col, value: ids })
        return Promise.resolve({ error: null })
      }),
      eq: vi.fn((col: string, value: unknown) => {
        updateCalls.push({ payload, filter: col, value })
        return Promise.resolve({ error: null })
      }),
    })),
  }))

  return { from, updateCalls }
}

describe('REGRESSÃO: unstickPublishingItems — recovery de itens órfãos em publishing', () => {
  it('nenhum item preso → não faz nenhuma escrita', async () => {
    const { from, updateCalls } = makeSupabaseMock([])
    const result = await unstickPublishingItems({ from } as never, 'ws-1', 3)

    expect(result).toEqual({ unstuck: 0, retried: 0, failed: 0 })
    expect(updateCalls).toHaveLength(0)
  })

  it('item preso com retry_count abaixo do limite → volta para approved com retry_count+1', async () => {
    const { from, updateCalls } = makeSupabaseMock([{ id: 'item-a', retry_count: 1 }])
    const result = await unstickPublishingItems({ from } as never, 'ws-1', 3)

    expect(result).toEqual({ unstuck: 1, retried: 1, failed: 0 })
    const retryCall = updateCalls.find(c => c.filter === 'id' && c.value === 'item-a')
    expect(retryCall).toBeDefined()
    expect(retryCall!.payload).toEqual({ status: 'approved', retry_count: 2 })
  })

  it('item preso já no limite de retries → marcado failed em vez de retry', async () => {
    const { from, updateCalls } = makeSupabaseMock([{ id: 'item-b', retry_count: 2 }])
    const result = await unstickPublishingItems({ from } as never, 'ws-1', 3)

    expect(result).toEqual({ unstuck: 1, retried: 0, failed: 1 })
    const failCall = updateCalls.find(c => c.filter === 'id' && Array.isArray(c.value) && (c.value as string[]).includes('item-b'))
    expect(failCall).toBeDefined()
    expect(failCall!.payload).toEqual({ status: 'failed', review_feedback: 'Timeout: stuck in publishing state' })
  })

  it('retryAttempts=0 usa default de 3 tentativas (config ausente não derruba o retry)', async () => {
    const { from } = makeSupabaseMock([{ id: 'item-c', retry_count: 0 }])
    const result = await unstickPublishingItems({ from } as never, 'ws-1', 0)

    // 0 é falsy → cai no `|| 3` — retry_count 0+1=1 < 3 → retry, não failed
    expect(result).toEqual({ unstuck: 1, retried: 1, failed: 0 })
  })

  it('mistura de itens retry e failed no mesmo lote é contabilizada corretamente', async () => {
    const { from } = makeSupabaseMock([
      { id: 'item-retry', retry_count: 0 },
      { id: 'item-fail', retry_count: 2 },
    ])
    const result = await unstickPublishingItems({ from } as never, 'ws-1', 3)

    expect(result).toEqual({ unstuck: 2, retried: 1, failed: 1 })
  })
})
