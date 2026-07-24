/**
 * Lógica pura de métricas de engajamento de Reels (Instagram).
 *
 * Extraída do cron reels-metrics para ser testável sem mockar Supabase/IG API.
 *
 * REGRA: o engajamento vive em colunas DEDICADAS (engagement_score, engagement_metrics,
 * reach, engagement_rate). NUNCA em review_score/review_feedback — esses são o sinal de
 * qualidade pré-publicação do Reviewer. Conflar os dois tankou as notas dos reels (~2.24).
 */

/** Conjunto de métricas de insights de Reel pedido à Graph API (graph.facebook.com). */
export const IG_INSIGHTS_METRICS =
  'ig_reels_avg_watch_time,ig_reels_video_view_total_time,likes,comments,saved,shares,reach,total_interactions'

export interface ReelEngagement {
  reach: number
  likes: number
  comments: number
  saved: number
  shares: number
  total_interactions: number
  avg_watch_time_ms: number
  total_view_time_ms: number
  fetched_at: string
}

/** engagement_rate (%) = interações / reach. Gate: reach 0 → 0 (evita divisão por zero). */
export function computeEngagementRate(
  e: Pick<ReelEngagement, 'reach' | 'likes' | 'comments' | 'saved' | 'shares'>,
): number {
  return e.reach > 0
    ? Math.round(((e.likes + e.comments + e.saved + e.shares) / e.reach) * 10000) / 100
    : 0
}

/** Score 0-10 ponderado: engagement rate (saves/shares pesam mais) + watch time + reach. */
export function calculateEngagementScore(m: {
  reach: number; likes: number; comments: number; saved: number; shares: number; avg_watch_time_ms: number
}): number {
  if (m.reach === 0) return 0
  const engagementRate = (m.likes + m.comments * 3 + m.saved * 5 + m.shares * 7) / m.reach
  const watchScore = Math.min(m.avg_watch_time_ms / 10000, 1) // 10s+ = max
  const raw = (engagementRate * 50) + (watchScore * 5) + Math.min(m.reach / 1000, 3)
  return Math.round(Math.min(10, Math.max(0, raw)) * 10) / 10
}

/**
 * Payload de UPDATE em generated_content. Por contrato, só colunas dedicadas de
 * engajamento — NUNCA review_score nem review_feedback. O teste de regressão trava isto.
 */
export function buildEngagementUpdate(e: ReelEngagement): {
  engagement_score: number
  engagement_metrics: ReelEngagement
  reach: number
  engagement_rate: number
} {
  return {
    engagement_score: calculateEngagementScore(e),
    engagement_metrics: e,
    reach: e.reach,
    engagement_rate: computeEngagementRate(e),
  }
}

/**
 * Detecta erro de credencial PERMANENTE do Graph API a partir do corpo da resposta.
 * #10 = app sem permissão (instagram_manage_insights ausente); #190 = token expirado;
 * #200 = permissão insuficiente. Nestes casos não adianta tentar os outros reels.
 */
export function parsePermanentAuthError(body: string): { code: number; message: string } | null {
  try {
    const err = (JSON.parse(body) as { error?: { code?: number; message?: string } }).error
    if (err && (err.code === 10 || err.code === 190 || err.code === 200)) {
      return { code: err.code, message: err.message ?? '' }
    }
  } catch { /* corpo não-JSON */ }
  return null
}
