import { NextResponse } from 'next/server'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { getAdminClient } from '@/lib/supabase/admin'
import type { TablesUpdate } from '@/lib/supabase/database.types'
import {
  normalizeHandle,
  validateExternalHandle,
} from '@/lib/engagement-profiles/same-owner'

export async function GET() {
  const workspaceId = await getActiveWorkspaceId()
  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('engagement_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(request: Request) {
  const body = await request.json()
  const handle = normalizeHandle(body?.handle)
  const platform = typeof body?.platform === 'string' ? body.platform.trim().toLowerCase() : 'x'
  const maxDaily = Number(body?.max_daily_interactions ?? 3)

  if (!handle) {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 })
  }

  if (!Number.isFinite(maxDaily) || maxDaily < 1 || maxDaily > 20) {
    return NextResponse.json({ error: 'max_daily_interactions must be between 1 and 20' }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const validationError = await validateExternalHandle(workspaceId, handle, platform)
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 })
  }

  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('engagement_profiles')
    .insert({
      workspace_id: workspaceId,
      handle,
      platform,
      active: true,
      config: { max_daily_interactions: maxDaily },
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PUT(request: Request) {
  const body = await request.json()
  const id = typeof body?.id === 'string' ? body.id : ''
  const active = typeof body?.active === 'boolean' ? body.active : null
  const maxDaily = body?.max_daily_interactions

  if (!id || active === null) {
    return NextResponse.json({ error: 'id and active (boolean) required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { active }
  if (maxDaily !== undefined) {
    const parsed = Number(maxDaily)
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
      return NextResponse.json({ error: 'max_daily_interactions must be between 1 and 20' }, { status: 400 })
    }
    patch.config = { max_daily_interactions: parsed }
  }

  const workspaceId = await getActiveWorkspaceId()
  const supabase = getAdminClient()
  const { error } = await supabase
    .from('engagement_profiles')
    .update(patch as TablesUpdate<'engagement_profiles'>)
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const supabase = getAdminClient()
  const { error } = await supabase
    .from('engagement_profiles')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
