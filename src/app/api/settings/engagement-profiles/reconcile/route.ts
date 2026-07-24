import { NextResponse } from 'next/server'
import { getActiveWorkspaceId } from '@/lib/config/workspace'
import { reconcileSameOwnerEngagementProfiles } from '@/lib/engagement-profiles/same-owner'

export async function POST() {
  const workspaceId = await getActiveWorkspaceId()
  const result = await reconcileSameOwnerEngagementProfiles(workspaceId)
  return NextResponse.json({
    ok: true,
    deactivatedCount: result.deactivatedCount,
    handles: result.handles,
  })
}
