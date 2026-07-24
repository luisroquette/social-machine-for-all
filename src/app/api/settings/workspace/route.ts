import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/database.types'
import { getAuthorizedWorkspace } from '@/lib/api/auth'


export async function GET(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const supabase = getAdminClient()
  const { data } = await supabase.from('workspaces').select('*').eq('id', access.workspaceId).eq('owner_id', access.userId).single()
  return NextResponse.json(data)
}

export async function PUT(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const body = await request.json()
  const allowed = ['name', 'description', 'topic_keywords', 'brand_config', 'telegram_group_id']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  updates.updated_at = new Date().toISOString()

  const supabase = getAdminClient()
  const { error } = await supabase.from('workspaces').update(updates as TablesUpdate<'workspaces'>).eq('id', access.workspaceId).eq('owner_id', access.userId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
