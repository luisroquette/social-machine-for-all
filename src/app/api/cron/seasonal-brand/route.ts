export const maxDuration = 60

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { runSeasonalBrand } from '@/lib/pipeline/brand-seasonal-dates'
import { WORKSPACE_ID } from '@/lib/config/constants'

/**
 * Roda 1x/dia. Verifica o calendário editorial de datas comemorativas do
 * @brand (brand_seasonal_dates) e, para cada ocasião que cai hoje, publica
 * um asset pré-feito fixado nela (seasonal_slug) ou semeia curated_content
 * para o pipeline writer→reviewer→publisher gerar o post via IA. Soma-se ao
 * conteúdo normal do dia (evergreen, reels) — nunca substitui.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!WORKSPACE_ID) {
    return NextResponse.json({ success: false, reason: 'workspace_not_configured' }, { status: 409 })
  }

  const results = await runSeasonalBrand(WORKSPACE_ID)

  return NextResponse.json({ success: true, occasionsToday: results.length, results })
}
