import { getAdminClient } from '@/lib/supabase/admin'

interface RateLimitCheck {
  allowed: boolean
  remaining: number
  resetAt: Date
}

export async function checkRateLimit(
  agentId: string,
  maxPerHour: number
): Promise<RateLimitCheck> {
  const supabase = getAdminClient()
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()

  const { count } = await supabase
    .from('agent_actions')
    .select('*', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .gte('created_at', oneHourAgo) as { count: number | null }

  const used = count ?? 0
  const remaining = Math.max(0, maxPerHour - used)

  return {
    allowed: remaining > 0,
    remaining,
    resetAt: new Date(Date.now() + 60 * 60 * 1000),
  }
}
