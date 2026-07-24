import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getAllSettings, updateSetting, VARIABLE_DEFINITIONS, CATEGORY_LABELS } from '@/lib/settings/load-settings'
import { getAdminClient } from '@/lib/supabase/admin'


// Super admin emails — only these users can access /variables
const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

async function isSuperAdmin(): Promise<boolean> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() } } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return false
  // If no SUPER_ADMIN_EMAILS configured, allow any authenticated user
  if (SUPER_ADMIN_EMAILS.length === 0) return true
  return SUPER_ADMIN_EMAILS.includes(user.email)
}

// GET: return all variables with definitions and current values
export async function GET() {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const settings = await getAllSettings(workspaceId)

  // Group by category with metadata
  const grouped: Record<string, {
    label: string
    description: string
    variables: Array<{
      key: string
      value: string
      label: string
      description: string
      type: string
      defaultValue: string
    }>
  }> = {}

  for (const s of settings) {
    const def = VARIABLE_DEFINITIONS.find(d => d.key === s.key)
    if (!def) continue

    if (!grouped[s.category]) {
      const meta = CATEGORY_LABELS[s.category] || { label: s.category, description: '' }
      grouped[s.category] = { label: meta.label, description: meta.description, variables: [] }
    }

    grouped[s.category].variables.push({
      key: s.key,
      value: s.value,
      label: def.label,
      description: def.description,
      type: def.type,
      defaultValue: def.defaultValue,
    })
  }

  return NextResponse.json(grouped)
}

// PUT: update one or more variables
export async function PUT(request: Request) {
  if (!(await isSuperAdmin())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const workspaceId = await getActiveWorkspaceId()
  const body = await request.json() as Record<string, string>

  for (const [key, value] of Object.entries(body)) {
    const def = VARIABLE_DEFINITIONS.find(d => d.key === key)
    if (!def) continue
    await updateSetting(workspaceId, def.category, key, String(value))
  }

  return NextResponse.json({ ok: true, updated: Object.keys(body).length })
}
