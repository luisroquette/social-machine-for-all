/**
 * Busca o total de seguidores (e nº de posts) do perfil via Instagram Graph API.
 *
 * Por que existe (16/06/2026):
 * O perfil tem muitas views mas poucos seguidores e o sistema NÃO media seguidores.
 * `followers_count` é um campo básico (funciona com o token EAA atual, sem precisar
 * do scope instagram_manage_insights que as insights por-reel exigem). Um snapshot
 * diário disso permite medir crescimento e conversão view->follow ao longo do tempo.
 *
 * Nunca lança: em erro/timeout/resposta inesperada retorna null (o cron segue).
 */
export async function fetchFollowerCount(
  apiBase: string,
  igUserId: string,
  token: string,
  timeoutMs = 15_000,
): Promise<{ followersCount: number; mediaCount: number } | null> {
  if (!igUserId || !token) return null
  try {
    const res = await fetch(
      `${apiBase}/${igUserId}?fields=followers_count,media_count&access_token=${token}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    )
    if (!res.ok) return null
    const j = (await res.json()) as { followers_count?: number; media_count?: number }
    if (typeof j.followers_count !== 'number') return null
    return { followersCount: j.followers_count, mediaCount: j.media_count ?? 0 }
  } catch {
    return null
  }
}
