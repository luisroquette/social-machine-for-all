/**
 * Curator feedback — fecha o loop de engajamento no Curator (fase 2).
 *
 * Análise (@your_ai_profile): o autor da fonte é um sinal forte e LIMPO de reach dos nossos
 * reels — BrianRoemmele/ClaudeDevs/ycombinator rendem 5–9x o reach mediano, enquanto autores
 * de alto volume (FutureStacked, RoundtableSpace, OpenAI oficial) ficam perto do piso.
 * Mas o ranking do Curator não conhecia o desempenho REAL pós-publicação.
 *
 * Este módulo aprende um multiplicador por autor a partir do reach dos reels já publicados,
 * aplicado no ranking (Optimization 10). NÃO precisa de taxonomia de tópico (source_author
 * já existe). Multiplicador é suavizado (raiz) e limitado para nunca dominar a virality score
 * nem matar a diversidade de fontes (que tem enforcement próprio no Curator).
 */

import { getAdminClient } from '@/lib/supabase/admin'

const MIN_SAMPLE = 3      // autores com menos reels que isto ficam neutros (sinal insuficiente)
const W_MIN = 0.6
const W_MAX = 1.6

/**
 * Peso de um autor (PURO — testável). Razão entre o reach médio do autor e a referência
 * global (mediana), suavizada por raiz quadrada e limitada a [0.6, 1.6]. Neutro (1.0) quando
 * a amostra é pequena ou não há referência.
 */
export function computeAuthorWeight(avgReach: number, refReach: number, sampleSize: number): number {
  if (sampleSize < MIN_SAMPLE || refReach <= 0) return 1
  const w = Math.sqrt(avgReach / refReach)
  return Math.max(W_MIN, Math.min(W_MAX, Math.round(w * 100) / 100))
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const s = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Constrói o mapa autor→peso a partir do reach real dos reels publicados do workspace.
 * Chaves em lowercase (casar com authorHandle independente de caixa). Vazio se sem dados.
 */
export async function buildAuthorReachWeights(workspaceId: string, daysBack = 60): Promise<Map<string, number>> {
  const supabase = getAdminClient()
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('generated_content')
    .select('reach, curated_content:curated_content_id(source_author)')
    .eq('workspace_id', workspaceId)
    .eq('target_format', 'reel')
    .eq('status', 'published')
    .not('reach', 'is', null)
    .gte('published_at', since)
    .limit(1000)

  const weights = new Map<string, number>()
  if (!data?.length) return weights

  const rows = data as Array<{ reach: number; curated_content: { source_author?: string } | { source_author?: string }[] | null }>

  const byAuthor = new Map<string, number[]>()
  const allReach: number[] = []
  for (const r of rows) {
    if (typeof r.reach !== 'number') continue
    allReach.push(r.reach)
    const cc = Array.isArray(r.curated_content) ? r.curated_content[0] : r.curated_content
    const author = cc?.source_author?.trim().toLowerCase()
    if (!author) continue
    const arr = byAuthor.get(author) ?? []
    arr.push(r.reach)
    byAuthor.set(author, arr)
  }

  const ref = median(allReach)
  for (const [author, reaches] of byAuthor) {
    const avg = reaches.reduce((s, x) => s + x, 0) / reaches.length
    const w = computeAuthorWeight(avg, ref, reaches.length)
    if (w !== 1) weights.set(author, w) // só guarda quem desvia do neutro
  }

  return weights
}
