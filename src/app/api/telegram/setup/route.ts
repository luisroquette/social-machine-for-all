import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { botManager } from '@/lib/telegram/bot-manager'

export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getAdminClient()
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id')
    .limit(1)
    .single()

  if (!workspace?.id) {
    return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
  }

  botManager.reset()
  await botManager.loadFromDatabase(workspace.id)

  const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.NEXT_PUBLIC_APP_URL ?? ''

  if (!baseUrl) {
    return NextResponse.json({ error: 'BASE_URL not configured' }, { status: 500 })
  }

  const results = await botManager.setupWebhooks(baseUrl)

  return NextResponse.json({ ok: true, baseUrl, results })
}
