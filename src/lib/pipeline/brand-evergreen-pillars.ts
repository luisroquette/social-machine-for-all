import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable, updateSetting } from '@/lib/settings/load-settings'

export const PILLARS = ['dor', 'modelo', 'execucao', 'midia', 'fomo', 'diptych', 'generico'] as const
export type Pillar = typeof PILLARS[number]

const FACTS_PER_ITEM = 4
// Alto o suficiente para vencer a ordenação `order('relevance_score', desc).limit(writerLimit)`
// do writer (src/lib/agents/writer/index.ts) frente a itens de notícia (score tipicamente 0-60).
const EVERGREEN_RELEVANCE_SCORE = 100

/**
 * Semeia um item de curated_content grounded em fatos reais do pilar da vez,
 * para o writer/reviewer/publisher (já existentes) transformarem em carousel/feed_post.
 */
export async function seedEvergreenPillarItem(
  workspaceId: string,
): Promise<{ curatedContentId: string; pillar: Pillar; factsUsed: number } | null> {
  const supabase = getAdminClient()

  const cursorRaw = await getVariable(workspaceId, 'evergreen_pillar_cursor')
  const cursor = parseInt(cursorRaw, 10) || 0
  const pillar = PILLARS[cursor % PILLARS.length]

  const { data: facts, error: factsError } = await supabase
    .from('brand_pillar_facts')
    .select('id, fact, used_count')
    .eq('workspace_id', workspaceId)
    .eq('pillar', pillar)
    .order('used_count', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(FACTS_PER_ITEM)

  if (factsError) {
    console.error('[brand-evergreen-pillars] facts query failed:', factsError.message)
    return null
  }
  if (!facts || facts.length === 0) {
    return null
  }

  const sourceContent = facts.map((f: { fact: string }, i: number) => `FATO ${i + 1}: ${f.fact}`).join('\n')

  const { data: inserted, error: insertError } = await supabase
    .from('curated_content')
    .insert({
      workspace_id: workspaceId,
      source_platform: 'pillar',
      source_content: sourceContent,
      relevance_score: EVERGREEN_RELEVANCE_SCORE,
      // category NUNCA pode ficar vazio: o writer filtra
      // `.not('score_breakdown->>category', 'in', '("noise","opinion")')` e, em Postgres,
      // `NULL NOT IN (...)` é NULL (falsy) — sem category a linha é excluída silenciosamente.
      score_breakdown: { category: 'ev_market_br', pillar },
      status: 'curated',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[brand-evergreen-pillars] curated_content insert failed:', insertError.message)
    return null
  }
  if (!inserted) {
    return null
  }

  await Promise.all(
    facts.map(async (f: { id: string; used_count: number }) => {
      const { error } = await supabase.from('brand_pillar_facts').update({ used_count: f.used_count + 1 }).eq('id', f.id)
      if (error) {
        console.warn(`[brand-evergreen-pillars] failed to increment used_count for fact ${f.id}: ${error.message}`)
      }
    }),
  )

  const nextCursor = (cursor + 1) % PILLARS.length
  await updateSetting(workspaceId, 'pipeline', 'evergreen_pillar_cursor', String(nextCursor))

  return { curatedContentId: inserted.id, pillar, factsUsed: facts.length }
}
