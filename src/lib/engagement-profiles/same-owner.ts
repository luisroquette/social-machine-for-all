import { getAdminClient } from '@/lib/supabase/admin'
import { getVariable, loadSettings } from '@/lib/settings/load-settings'
import { parseHandleList } from '@/lib/agents/engagement-own/loop-guardrails'

export const BUILTIN_OWNED_X_HANDLES = ['example_handle'] as const

export function normalizeHandle(value: string | null | undefined): string {
  return (value ?? '').replace(/^@/, '').trim().toLowerCase()
}

export async function loadOwnedHandles(workspaceId: string): Promise<Set<string>> {
  const settings = await loadSettings(workspaceId)
  const [primaryTwitterHandle, ownedHandlesCsv] = await Promise.all([
    getVariable(workspaceId, 'twitter_handle'),
    getVariable(workspaceId, 'owned_x_handles'),
  ])

  return parseHandleList(
    settings.own_twitter_handle,
    settings.target_handle,
    primaryTwitterHandle,
    ownedHandlesCsv,
    BUILTIN_OWNED_X_HANDLES.join(',')
  )
}

export async function validateExternalHandle(workspaceId: string, handle: string, platform: string): Promise<string | null> {
  const normalizedHandle = normalizeHandle(handle)
  if (!normalizedHandle) return 'invalid handle'

  if (platform === 'x' || platform === 'twitter') {
    const ownedHandles = await loadOwnedHandles(workspaceId)
    if (ownedHandles.has(normalizedHandle)) {
      return `same-owner handle blocked: @${normalizedHandle} pertence à operação local`
    }
  }

  return null
}

export async function reconcileSameOwnerEngagementProfiles(workspaceId: string): Promise<{
  deactivatedCount: number
  handles: string[]
}> {
  const supabase = getAdminClient()
  const ownedHandles = await loadOwnedHandles(workspaceId)
  const { data, error } = await supabase
    .from('engagement_profiles')
    .select('id, handle, platform, active')
    .eq('workspace_id', workspaceId)
    .eq('active', true)

  if (error || !data?.length) {
    return { deactivatedCount: 0, handles: [] }
  }

  const candidates = data.filter((profile) => {
    const platform = (profile.platform ?? '').toLowerCase()
    return (platform === 'x' || platform === 'twitter') && ownedHandles.has(normalizeHandle(profile.handle))
  })

  for (const profile of candidates) {
    await supabase
      .from('engagement_profiles')
      .update({ active: false })
      .eq('workspace_id', workspaceId)
      .eq('id', profile.id)
  }

  return {
    deactivatedCount: candidates.length,
    handles: candidates.map(profile => normalizeHandle(profile.handle)),
  }
}
