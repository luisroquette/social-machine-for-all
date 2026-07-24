/**
 * Decide se um workspace está "sem postar" no Instagram — usado pelo digest
 * de status 2x/dia (garantia mínima de alerta, independente de qualquer
 * cooldown/dedup/pause-week do heartbeat reativo).
 *
 * Why: em jun/2026 o heartbeat reativo silenciou um outage real por dias porque
 * a lógica de supressão da pause week mascarou a falha (ver pause-week.ts).
 * Este check roda em horários fixos (2x/dia) e não depende de nenhum estado
 * de cooldown — só olha o fato: quando foi o último post publicado.
 */
export function hoursSince(referenceMs: number, pastIso: string | null): number | null {
  if (!pastIso) return null
  return (referenceMs - new Date(pastIso).getTime()) / (60 * 60 * 1000)
}

export function isInstagramStale(hoursSinceLastPublish: number | null, staleHours: number): boolean {
  return hoursSinceLastPublish === null || hoursSinceLastPublish > staleHours
}
