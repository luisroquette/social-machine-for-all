import type { SupabaseClient } from '@supabase/supabase-js'

export function xBacklogCapacity(publishedLast7d: number, maxContentAgeHours: number): number {
  return Math.max(20, Math.round((publishedLast7d / 7) * (maxContentAgeHours / 24) * 1.5))
}

export async function loadXBackpressure(
  client: SupabaseClient,
  workspaceId: string,
  format: 'x' | 'thread',
): Promise<{ blocked: boolean; reason: string }> {
  const publishedSince = new Date(Date.now() - 7 * 86_400_000).toISOString()
  const [approved, published, setting] = await Promise.all([
    client.from('generated_content').select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('target_platform', 'x').eq('target_format', format).eq('status', 'approved'),
    client.from('generated_content').select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId).eq('target_platform', 'x').eq('target_format', format).eq('status', 'published')
      .gte('published_at', publishedSince),
    client.from('workspace_settings').select('value').eq('workspace_id', workspaceId)
      .eq('key', 'curator_max_tweet_age_hours').maybeSingle(),
  ])

  if (approved.error || published.error || setting.error || approved.count === null || published.count === null) {
    return { blocked: true, reason: 'capacity evidence unavailable' }
  }
  const maxAge = Number(setting.data?.value ?? 72)
  if (!Number.isFinite(maxAge) || maxAge <= 0) return { blocked: true, reason: 'invalid max content age' }
  const capacity = xBacklogCapacity(published.count, maxAge)
  return {
    blocked: approved.count >= capacity,
    reason: `${approved.count} approved / capacity ${capacity}`,
  }
}
