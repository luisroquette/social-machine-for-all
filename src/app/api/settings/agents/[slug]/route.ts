import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/database.types'
import { getAuthorizedWorkspace } from '@/lib/api/auth'

interface RouteParams { params: Promise<{ slug: string }> }

// GET: return agent config from agents table
export async function GET(request: Request, { params }: RouteParams) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const { slug } = await params
  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('agents')
    .select('*')
    .eq('slug', slug)
    .eq('workspace_id', access.workspaceId)
    .single()
  if (error || !data) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  return NextResponse.json(data)
}

// PUT: update agent config fields
export async function PUT(request: Request, { params }: RouteParams) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const { slug } = await params
  const body = await request.json()

  // Only allow updating specific fields
  const allowed = ['name', 'model', 'system_prompt', 'config', 'schedule_cron', 'schedule_enabled',
    'max_actions_per_hour', 'quiet_hours_start', 'quiet_hours_end', 'active', 'telegram_bot_token', 'telegram_bot_username']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }
  updates.updated_at = new Date().toISOString()

  const supabase = getAdminClient()
  const { error } = await supabase.from('agents').update(updates as TablesUpdate<'agents'>).eq('slug', slug).eq('workspace_id', access.workspaceId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
