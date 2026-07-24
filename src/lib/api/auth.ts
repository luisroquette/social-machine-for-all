import crypto from 'crypto'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { getAdminClient } from '@/lib/supabase/admin'

export async function validateApiAuth(request: Request): Promise<{ user: { id: string; email?: string } } | NextResponse> {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll() {},
        },
      }
    )

    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return { user: { id: user.id, email: user.email } }
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

/** Authenticates an API caller and verifies ownership of the selected workspace. */
export async function getAuthorizedWorkspace(request: Request): Promise<{ workspaceId: string; userId: string } | NextResponse> {
  const auth = await validateApiAuth(request)
  if (auth instanceof NextResponse) return auth
  const workspaceId = await getActiveWorkspaceId()
  if (!workspaceId) return NextResponse.json({ error: 'Workspace not configured' }, { status: 409 })
  const { data, error } = await getAdminClient()
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('owner_id', auth.user.id)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Forbidden workspace' }, { status: 403 })
  return { workspaceId, userId: auth.user.id }
}

export function isCronRequest(request: Request): boolean {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!authHeader || authHeader.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
  } catch {
    return false
  }
}

export function isTelegramWebhook(request: Request): boolean {
  const secret = request.headers.get('x-telegram-bot-api-secret-token')
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret || !expected || secret.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
  } catch {
    return false
  }
}
