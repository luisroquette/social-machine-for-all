'use server'

import { getAdminClient } from '@/lib/supabase/admin'
import { getBaseUrl } from '@/lib/api/base-url'

export async function rejectContent(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getAdminClient()
  const { error } = await supabase
    .from('generated_content')
    .update({ status: 'rejected', review_feedback: 'Rejeitado manualmente via dashboard' })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function publishContent(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = getAdminClient()

  const { error } = await supabase
    .from('generated_content')
    .update({ status: 'approved', retry_count: 0 })
    .eq('id', id)
  if (error) return { ok: false, error: error.message }

  const { data: item } = await supabase
    .from('generated_content')
    .select('workspace_id')
    .eq('id', id)
    .single()

  fetch(`${getBaseUrl()}/api/agents/publisher/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ workspaceId: item?.workspace_id, trigger: 'dashboard' }),
  }).catch(() => {})

  return { ok: true }
}
