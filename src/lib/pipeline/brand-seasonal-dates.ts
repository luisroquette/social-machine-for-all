import { getAdminClient } from '@/lib/supabase/admin'
import { publishMarketingAssetRow } from '@/lib/pipeline/brand-marketing-assets'

export interface SeasonalDateRow {
  id: string
  slug: string
  name: string
  month: number | null
  day: number | null
  easter_offset_days: number | null
  angle: string
  is_priority: boolean
  restriction_notes: string | null
  last_used_year: number | null
}

/**
 * Domingo de Páscoa para um ano gregoriano (algoritmo anônimo / Meeus-Jones-Butcher).
 * Base de todas as datas móveis do calendário (Carnaval, Cinzas, Corpus Christi).
 */
export function computeEasterSunday(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

/** Data (UTC, sem hora) em que uma ocasião cai num ano específico. */
export function resolveOccurrenceDate(
  row: Pick<SeasonalDateRow, 'month' | 'day' | 'easter_offset_days'>,
  year: number,
): Date {
  if (row.easter_offset_days !== null) {
    const easter = computeEasterSunday(year)
    const base = new Date(Date.UTC(year, easter.month - 1, easter.day))
    base.setUTCDate(base.getUTCDate() + row.easter_offset_days)
    return base
  }
  return new Date(Date.UTC(year, (row.month as number) - 1, row.day as number))
}

function isSameUTCDate(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
}

function evCategoryFocusSeasonal(row: SeasonalDateRow): string {
  const restriction = row.restriction_notes ? `\nRESTRIÇÃO OBRIGATÓRIA: ${row.restriction_notes}` : ''
  return (
    `DATA COMEMORATIVA: ${row.name}\n` +
    `ÂNGULO EDITORIAL OBRIGATÓRIO (fio condutor do post, não fuja dele): ${row.angle}${restriction}`
  )
}

/**
 * Roda 1x/dia. Para cada ocasião do calendário sazonal que cai HOJE:
 *  - se existir um asset pré-feito fixado nela (brand_marketing_assets.seasonal_slug),
 *    publica esse asset diretamente (mesmo fluxo de moldura 3:4 do pool normal);
 *  - senão, semeia curated_content grounded no ângulo editorial da data para o
 *    pipeline writer→reviewer→publisher (já existente) gerar o post via IA.
 * Nunca substitui o conteúdo normal do dia (evergreen, reels) — sempre soma.
 */
export async function runSeasonalBrand(
  workspaceId: string,
  today: Date = new Date(),
): Promise<Array<{ slug: string; action: 'seeded_ai' | 'published_asset' | 'skipped_no_facts'; detail?: string }>> {
  const supabase = getAdminClient()
  const year = today.getUTCFullYear()

  const { data: rows, error } = await supabase
    .from('brand_seasonal_dates')
    .select('id, slug, name, month, day, easter_offset_days, angle, is_priority, restriction_notes, last_used_year')
    .eq('workspace_id', workspaceId)
    .eq('enabled', true)
    .or(`last_used_year.is.null,last_used_year.lt.${year}`)

  if (error || !rows) {
    console.error('[brand-seasonal-dates] failed to load seasonal dates:', error?.message)
    return []
  }

  const dueToday = (rows as SeasonalDateRow[]).filter((row) => isSameUTCDate(resolveOccurrenceDate(row, year), today))
  const results: Array<{ slug: string; action: 'seeded_ai' | 'published_asset' | 'skipped_no_facts'; detail?: string }> = []

  for (const row of dueToday) {
    const { data: pinnedAsset } = await supabase
      .from('brand_marketing_assets')
      .select('id, public_url, caption, pillar')
      .eq('workspace_id', workspaceId)
      .eq('seasonal_slug', row.slug)
      .is('used_at', null)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (pinnedAsset) {
      const publishResult = await publishMarketingAssetRow(supabase, workspaceId, pinnedAsset)
      results.push({ slug: row.slug, action: 'published_asset', detail: publishResult.success ? publishResult.postUrl : publishResult.error })
    } else {
      const { error: insertError } = await supabase.from('curated_content').insert({
        workspace_id: workspaceId,
        source_platform: 'seasonal',
        source_content: evCategoryFocusSeasonal(row),
        // Datas ★ (is_priority) recebem score acima do evergreen (100) para nunca
        // ficarem de fora do top-N do writer (writer_max_items_per_run) quando
        // concorrem no mesmo run com o item evergreen diário ou com um backlog
        // de itens represados — a data comemorativa não se repete no ano.
        relevance_score: row.is_priority ? 150 : 100,
        score_breakdown: { category: 'seasonal', pillar: 'seasonal', seasonal_slug: row.slug },
        status: 'curated',
      })
      if (insertError) {
        console.error(`[brand-seasonal-dates] curated_content insert failed for ${row.slug}:`, insertError.message)
        results.push({ slug: row.slug, action: 'skipped_no_facts', detail: insertError.message })
        continue
      }
      results.push({ slug: row.slug, action: 'seeded_ai' })
    }

    const { error: markError } = await supabase.from('brand_seasonal_dates').update({ last_used_year: year }).eq('id', row.id)
    if (markError) {
      console.warn(`[brand-seasonal-dates] failed to mark last_used_year for ${row.slug}:`, markError.message)
    }
  }

  return results
}
