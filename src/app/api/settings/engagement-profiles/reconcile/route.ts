import { NextResponse } from 'next/server'
import { reconcileSameOwnerEngagementProfiles } from '@/lib/engagement-profiles/same-owner'
import { getAuthorizedWorkspace } from '@/lib/api/auth'

export async function POST(request: Request) {
  const access = await getAuthorizedWorkspace(request)
  if (access instanceof NextResponse) return access
  const result = await reconcileSameOwnerEngagementProfiles(access.workspaceId)
  return NextResponse.json({
    ok: true,
    deactivatedCount: result.deactivatedCount,
    handles: result.handles,
  })
}
