/**
 * Política de retenção do cleanup-storage — extraída em módulo puro para ser
 * testável e para o cron não voltar a divergir do que existe de fato nos buckets.
 *
 * Contexto (jul/2026): o bucket 'reels' chegou a 13 GB porque o cron só limpava
 * downloads/ e covers/. As pastas de vídeo renderizado (capcut/, doomguy-frame/,
 * brand-frame/, brand-frame/) — metade do bucket — nunca eram tocadas, e o
 * list() sem paginação (limit 500, ordenado por NOME) deixava arquivos antigos
 * permanentemente invisíveis para a limpeza.
 *
 * Por que as retenções abaixo são seguras (verificado no código em 04/07/2026):
 * - Frames renderizados são consumidos NA MESMA RUN do publish (IG re-hospeda o
 *   vídeo; X/YouTube cross-postam na mesma execução). 14d é margem de sobra.
 * - Stories usam covers/ com delay máx. de 45min — 30d cobre com folga.
 * - covers/bg-{hash8}.png é cache com HEAD-check: se apagado, regenera. Sem quebra.
 * - downloads/{itemId}.mp4 é referenciado por itens reel_ready na fila; a fila é
 *   consumida em dias (cap de queue_full) — 30d é seguro mesmo com pause week.
 */

export interface CleanupTarget {
  bucket: string
  folder: string
  retentionDays: number
}

export const CLEANUP_TARGETS: ReadonlyArray<CleanupTarget> = [
  // bucket 'reels' (workspace AI & Tech + renders compartilhados do Railway)
  { bucket: 'reels', folder: 'downloads', retentionDays: 30 },
  { bucket: 'reels', folder: 'covers', retentionDays: 30 },
  { bucket: 'reels', folder: 'subtitled', retentionDays: 7 },
  { bucket: 'reels', folder: 'renders', retentionDays: 7 },
  { bucket: 'reels', folder: 'doomguy-frame', retentionDays: 14 },
  { bucket: 'reels', folder: 'brand-frame', retentionDays: 14 },
  { bucket: 'reels', folder: 'brand-frame', retentionDays: 14 },
  // capcut/: pipeline morto desde 06/06/2026 (substituído pelo doomguy-frame).
  // retentionDays 0 = qualquer arquivo é elegível — a pasta esvazia e some.
  { bucket: 'reels', folder: 'capcut', retentionDays: 0 },
  // bucket 'brand-mob' (workspace Brand) — não tinha limpeza nenhuma
  { bucket: 'brand-mob', folder: 'backgrounds', retentionDays: 30 },
  { bucket: 'brand-mob', folder: 'carousel', retentionDays: 30 },
  { bucket: 'brand-mob', folder: 'posts', retentionDays: 30 },
  { bucket: 'brand-mob', folder: 'reel-covers', retentionDays: 30 },
]

/** Pastas que NUNCA podem entrar em limpeza (assets permanentes de marca). */
export const PROTECTED_FOLDERS: ReadonlyArray<string> = ['brand', 'config']

export function isExpired(createdAt: string | null | undefined, retentionDays: number, nowMs: number): boolean {
  if (!createdAt) return false
  return new Date(createdAt).getTime() < nowMs - retentionDays * 24 * 60 * 60 * 1000
}

/**
 * Pagina a listagem completa de uma pasta. O list() do Supabase ordena por NOME
 * e trunca no limit — sem este loop, arquivos além da primeira página ficam
 * permanentemente invisíveis para a limpeza (bug que deixou 120+ vídeos de
 * downloads/ vivos além dos 30 dias).
 */
export async function listAllFiles<T extends { name: string }>(
  list: (offset: number, limit: number) => Promise<T[]>,
  pageSize = 100,
): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; offset += pageSize) {
    const page = await list(offset, pageSize)
    all.push(...page)
    if (page.length < pageSize) break
  }
  return all
}
