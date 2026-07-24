import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

/**
 * Cliente tipado com o schema real (src/lib/supabase/database.types.ts, gerado
 * de produção via `supabase gen types typescript`). Tipar este client é o fix
 * definitivo da classe do incidente 42703 (jun-jul/2026): uma query contra
 * coluna/tabela inexistente agora quebra o BUILD em vez de falhar silenciosa
 * em produção por 16 dias.
 *
 * Regenerar após qualquer migration: os types DEVEM acompanhar o schema.
 * Trap de regressão: src/lib/supabase/database-types.regression.test.ts.
 */
let adminClient: SupabaseClient<Database> | null = null

export function getAdminClient(): SupabaseClient<Database> {
  if (!adminClient) {
    adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  }
  return adminClient
}
