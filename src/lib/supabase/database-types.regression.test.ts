/**
 * REGRESSÃO (compile-time): getAdminClient DEVE permanecer tipado com o schema real
 *
 * Fix definitivo da classe do incidente 42703 (12/07/2026): o client era
 * `SupabaseClient<any>`, então query contra coluna/tabela inexistente compilava
 * e falhava silenciosa em produção (watchdog cego 16 dias; dashboard consultando
 * agent_actions.result_summary/agent_slug que nunca existiram; PATCH de
 * monitor_sources com updated_at inexistente; insights do ads-strategist nunca
 * gravados por 3 colunas erradas no insert).
 *
 * As trap-lines abaixo usam @ts-expect-error: se alguém reverter o client para
 * `any`, os erros esperados DESAPARECEM e o tsc quebra o build com
 * "Unused '@ts-expect-error' directive". Proteção em compile-time, não runtime.
 *
 * Manutenção: após qualquer migration, regenerar src/lib/supabase/database.types.ts
 * (supabase gen types typescript) — NUNCA remover a tipagem do client.
 */
import { describe, it, expect } from 'vitest'
import { getAdminClient } from './admin'

// ── Trap de compile-time (o teste em runtime nunca executa estas queries) ────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function compileTimeTraps() {
  const supabase = getAdminClient()

  // @ts-expect-error tabela inexistente deve ser rejeitada pelo client tipado
  supabase.from('tabela_que_nao_existe')

  // @ts-expect-error coluna inexistente em filtro deve ser rejeitada (caso agent_slug do dashboard)
  await supabase.from('agent_actions').select('id').eq('agent_slug', 'x')

  // @ts-expect-error coluna inexistente em insert deve ser rejeitada (caso result_summary)
  await supabase.from('agent_actions').insert({ workspace_id: 'w', action_type: 'a', result_summary: 'x' })

  // Positivo: colunas reais compilam sem erro (se isto quebrar, os types divergiram do uso legítimo)
  await supabase.from('generated_content').select('id, status, updated_at').eq('target_format', 'reel').limit(1)
}

describe('REGRESSÃO 42703 (compile-time): client Supabase tipado', () => {
  it('admin.ts importa Database do arquivo gerado e tipa o client', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const src = readFileSync(join(__dirname, 'admin.ts'), 'utf-8')
    expect(src).toContain("import type { Database } from './database.types'")
    expect(src).toContain('SupabaseClient<Database>')
    expect(src).not.toMatch(/type AnyDatabase = any/)
  })

  it('database.types.ts existe e cobre as tabelas críticas do pipeline', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const types = readFileSync(join(__dirname, 'database.types.ts'), 'utf-8')
    for (const table of ['generated_content', 'agent_actions', 'curated_content', 'workspaces', 'trend_video_jobs']) {
      expect(types, `tabela ${table} ausente dos types gerados`).toContain(`${table}: {`)
    }
  })
})
