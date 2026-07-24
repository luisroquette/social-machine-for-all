/**
 * Guard de queries de monitoramento — nascido do incidente 42703 (04/07/2026).
 *
 * Erros do Supabase NÃO lançam exceção: voltam em `{ data: null, error }`.
 * Destructurar só `{ data }`/`{ count }` engole o erro e o watchdog fica cego
 * em silêncio (foi assim que a coluna inexistente updated_at passou 16 dias
 * despercebida). Estas funções coletam toda falha num collector; o heartbeat
 * converte o collector em warning 🔴 + Sentry — um watchdog que falha deve
 * ALERTAR, nunca devolver null calado.
 *
 * Puro (sem I/O) de propósito: o Sentry/Telegram ficam no chamador.
 */

export interface DbErrorCollector {
  failures: string[]
}

export function createDbErrorCollector(): DbErrorCollector {
  return { failures: [] }
}

type PgError = { message: string; code?: string } | null

function record(collector: DbErrorCollector, label: string, error: NonNullable<PgError>): void {
  collector.failures.push(`${label} (${error.code ?? 'sem código'}: ${error.message})`)
}

/** Extrai `count` de uma resposta head/count do Supabase, coletando o erro se houver. */
export function guardCount(
  collector: DbErrorCollector,
  label: string,
  res: { count: number | null; error: PgError },
): number | null {
  if (res.error) {
    record(collector, label, res.error)
    return null
  }
  return res.count
}

/** Extrai `data` de uma resposta do Supabase, coletando o erro se houver. */
export function guardData<T>(
  collector: DbErrorCollector,
  label: string,
  res: { data: T | null; error: PgError },
): T | null {
  if (res.error) {
    record(collector, label, res.error)
    return null
  }
  return res.data
}
