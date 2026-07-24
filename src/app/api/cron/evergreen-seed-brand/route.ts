export const maxDuration = 60

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { seedEvergreenPillarItem } from '@/lib/pipeline/brand-evergreen-pillars'
import { WORKSPACE_ID } from '@/lib/config/constants'

/**
 * Roda 1x/dia. Semeia um único curated_content grounded no pilar evergreen da vez
 * (Dor→Modelo→Execução→Mídia→FOMO→Diptych→Genérico, loop sequencial) para o
 * pipeline writer→reviewer→publisher (já existente) transformar em carousel/feed_post.
 * Não gera Reels — o pipeline de Reels não é afetado por este cron.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!WORKSPACE_ID) {
    return NextResponse.json({ success: false, reason: 'workspace_not_configured' }, { status: 409 })
  }

  const result = await seedEvergreenPillarItem(WORKSPACE_ID)

  if (!result) {
    return NextResponse.json({ success: false, reason: 'no_facts_available_or_insert_failed' })
  }

  return NextResponse.json({
    success: true,
    pillar: result.pillar,
    factsUsed: result.factsUsed,
    curatedContentId: result.curatedContentId,
  })
}
