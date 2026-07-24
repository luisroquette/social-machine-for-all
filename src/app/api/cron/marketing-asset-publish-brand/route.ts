// 120 (era 60, 2026-07-15): publishImage sozinho (frame fetch 20s + criação de container 15s +
// poll 30s + media_publish 15s + fetchPermalink 10s = até 90s) já excedia os 60s antigos.
export const maxDuration = 120

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { publishNextMarketingAsset } from '@/lib/pipeline/brand-marketing-assets'

const BRAND_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Roda ~3x/semana. Publica o próximo asset real (pasta Marketing) ainda não
 * usado do @brand — imagem já pronta, sem geração de IA. Quando o pool de
 * assets esgotar, retorna success:false até novos assets serem cadastrados
 * em brand_marketing_assets.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await publishNextMarketingAsset(BRAND_WORKSPACE_ID)

  if (!result) {
    return NextResponse.json({ success: false, reason: 'no_unused_assets' })
  }

  return NextResponse.json(result)
}
