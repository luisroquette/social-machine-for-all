import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { NextResponse } from 'next/server'
import { getAllSettings, updateSetting } from '@/lib/settings/load-settings'


// GET: return all settings grouped by category
export async function GET() {
  const workspaceId = await getActiveWorkspaceId()
  const settings = await getAllSettings(workspaceId)
  // Group by category
  const grouped: Record<string, Array<{ key: string; value: string; description: string | null }>> = {}
  for (const s of settings) {
    if (!grouped[s.category]) grouped[s.category] = []
    grouped[s.category].push({ key: s.key, value: s.value, description: s.description })
  }
  return NextResponse.json(grouped)
}

// PUT: update a single setting
export async function PUT(request: Request) {
  const workspaceId = await getActiveWorkspaceId()
  const { category, key, value } = await request.json()
  if (!category || !key || value === undefined) {
    return NextResponse.json({ error: 'category, key, and value required' }, { status: 400 })
  }
  await updateSetting(workspaceId, category, key, String(value))
  return NextResponse.json({ ok: true })
}
