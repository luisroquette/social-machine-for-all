import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { getAuthorizedWorkspace } from '@/lib/api/auth'


// GET: list all monitor_sources for the workspace
export async function GET(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('monitor_sources')
    .select('*')
    .eq('workspace_id', access.workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST: add a new monitor_source (Twitter handle)
export async function POST(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const { handle } = await request.json()
  if (!handle || typeof handle !== 'string') {
    return NextResponse.json({ error: 'handle is required' }, { status: 400 })
  }

  const cleanHandle = handle.replace(/^@/, '').trim()
  if (!cleanHandle) {
    return NextResponse.json({ error: 'invalid handle' }, { status: 400 })
  }

  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('monitor_sources')
    .insert({
      workspace_id: access.workspaceId,
      platform: 'twitter',
      handle: cleanHandle,
      active: true,
      created_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

// PUT: toggle active status of a monitor_source
export async function PUT(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const { id, active } = await request.json()
  if (!id || typeof active !== 'boolean') {
    return NextResponse.json({ error: 'id and active (boolean) required' }, { status: 400 })
  }

  const supabase = getAdminClient()
  const { error } = await supabase
    .from('monitor_sources')
    .update({ active })
    .eq('id', id)
    .eq('workspace_id', access.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE: remove a monitor_source by id (via searchParams)
export async function DELETE(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query param required' }, { status: 400 })
  }

  const supabase = getAdminClient()
  const { error } = await supabase
    .from('monitor_sources')
    .delete()
    .eq('id', id)
    .eq('workspace_id', access.workspaceId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
