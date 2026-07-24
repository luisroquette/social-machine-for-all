import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/database.types'


export async function GET() {
  const workspaceId = await getActiveWorkspaceId()
  const supabase = getAdminClient()
  const { data } = await supabase.from('workspaces').select('*').eq('id', workspaceId).single()
  return NextResponse.json(data)
}

export async function PUT(request: Request) {
  const workspaceId = await getActiveWorkspaceId()
  const body = await request.json()
  const allowed = ['name', 'description', 'topic_keywords', 'brand_config', 'telegram_group_id']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  updates.updated_at = new Date().toISOString()

  const supabase = getAdminClient()
  const { error } = await supabase.from('workspaces').update(updates as TablesUpdate<'workspaces'>).eq('id', workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
