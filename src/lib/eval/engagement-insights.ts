/**
 * Engagement insights — aprendizado a partir do engajamento REAL dos Reels (não do review_score).
 *
 * Análise do corpus (@thedoomguy_ai, jun/2026): reach é cauda longa — mediana ~102,
 * top decil 1k–15k. O divisor é RETENÇÃO: reels com reach >=1000 têm ~11.6s de watch
 * time vs ~4.6s nos que morrem em <300. Os ganchos vencedores abrem com CURIOSIDADE +
 * PROTAGONISTA NOMEADO + STAKES (ex: "O CARA QUE DELETOU O CHATGPT DEPOIS DE VER O QUE
 * O CLAUDE FAZ"), mantendo o tema IA/tech.
 *
 * Este módulo destila esses padrões num bloco de prompt (espelha buildFeedbackGuardrails),
 * injetado no Writer (geração de gancho) e no Reviewer (contexto de avaliação).
 *
 * IMPORTANTE (equilíbrio editorial): protagonista nomeado SÓ quando a fonte fornece o nome
 * — nunca inventar (respeita o guardrail anti-fabricação do Writer).
 */

import { getAdminClient } from '@/lib/supabase/admin'

interface ReelPerf {
  hook: string
  reach: number
  watchMs: number
}

/** Extrai o hookTitle do content (JSON de reel); null se ausente/inválido. */
function extractHook(content: string | null): string | null {
  if (!content) return null
  try {
    const j = JSON.parse(content) as { hookTitle?: string }
    const h = (j.hookTitle ?? '').trim()
    return h.length > 0 ? h : null
  } catch {
    return null
  }
}

/**
 * Formata o bloco de orientação (PURO — testável sem DB).
 * Retorna '' quando não há sinal suficiente (evita injetar ruído no prompt).
 */
export function formatEngagementInsights(
  top: ReelPerf[],
  watchHighMs: number | null,
  watchLowMs: number | null,
  sampleSize: number,
): string {
  if (top.length === 0) return ''

  const lines: string[] = ['# O que DEU REACH de verdade (engajamento real, não opinião)']

  if (watchHighMs && watchLowMs && watchHighMs > watchLowMs) {
    lines.push(
      '',
      `Reels que alcançaram muita gente tiveram ~${(watchHighMs / 1000).toFixed(1)}s de retenção ` +
      `vs ~${(watchLowMs / 1000).toFixed(1)}s nos que morreram. **Retenção nos primeiros segundos = reach.** ` +
      `O gancho é o que segura — não a legenda.`,
    )
  }

  lines.push('', '## Ganchos que mais alcançaram (copie o FORMATO, não o assunto):')
  for (const r of top.slice(0, 6)) {
    lines.push(`- "${r.hook}" — alcançou ${r.reach.toLocaleString('pt-BR')}`)
  }

  lines.push(
    '',
    '## Padrão a seguir (mantendo o tema IA/tech):',
    '- Abra com CURIOSIDADE (lacuna que obriga a continuar assistindo), não com spec técnica seca.',
    '- Use PROTAGONISTA quando a fonte traz uma pessoa/empresa nomeada (ex: "o cara que...", "o ator que...") — NUNCA invente nomes que não estão na fonte.',
    '- Deixe os STAKES claros (o que está em jogo / o choque) na primeira frase.',
    `_Baseado nos ${sampleSize} reels com métrica real._`,
  )

  return lines.join('\n')
}

/**
 * Constrói o bloco de insights de engajamento para um workspace.
 * Lê os reels com engagement_metrics, rankeia por reach e destila os ganchos vencedores
 * + o sinal de retenção. Retorna '' se não houver sinal.
 */
export async function buildEngagementInsights(workspaceId: string, daysBack = 60): Promise<string> {
  const supabase = getAdminClient()
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('generated_content')
    .select('content, reach, engagement_metrics, published_at')
    .eq('workspace_id', workspaceId)
    .eq('target_format', 'reel')
    .eq('status', 'published')
    .not('reach', 'is', null)
    .gte('published_at', since)
    .order('reach', { ascending: false })
    .limit(120)

  if (!data?.length) return ''

  const rows = data as Array<{ content: string | null; reach: number; engagement_metrics: { avg_watch_time_ms?: number } | null }>

  // Top reels por reach que TÊM hook extraível.
  const top: ReelPerf[] = []
  for (const r of rows) {
    const hook = extractHook(r.content)
    if (hook) top.push({ hook, reach: r.reach, watchMs: r.engagement_metrics?.avg_watch_time_ms ?? 0 })
    if (top.length >= 6) break
  }

  // Sinal de retenção: watch time médio do tercil de cima vs reels de baixo alcance.
  const watchHigh: number[] = []
  const watchLow: number[] = []
  for (const r of rows) {
    const w = r.engagement_metrics?.avg_watch_time_ms
    if (typeof w !== 'number' || w <= 0) continue
    if (r.reach >= 1000) watchHigh.push(w)
    else if (r.reach < 300) watchLow.push(w)
  }
  const avg = (a: number[]) => (a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length) : null)

  return formatEngagementInsights(top, avg(watchHigh), avg(watchLow), rows.length)
}
