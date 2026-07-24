import { NextRequest, NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { getInstagramCredentials } from '@/lib/settings/load-credentials'
import { parseGeneratedContentJson } from '@/lib/trends/trend-giveaway'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const GRAPH_API = 'https://graph.facebook.com/v24.0'
const BATCH = 10

interface GiveawayLeadRow {
  id: string
  generated_content_id: string | null
  keyword: string
  status: string
}

function normalizeKeyword(value: string): string {
  return value.replace(/["'“”‘’.,!?]/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()
}

function includesKeyword(message: string, keyword: string): boolean {
  const normalizedMessage = normalizeKeyword(message)
  const normalizedKeyword = normalizeKeyword(keyword)
  return Boolean(normalizedKeyword && normalizedMessage.includes(normalizedKeyword))
}

async function sendInstagramDm(params: {
  accessToken: string
  recipientId: string
  text: string
}): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const query = new URLSearchParams({ access_token: params.accessToken })
  const body = new URLSearchParams({
    recipient: JSON.stringify({ id: params.recipientId }),
    message: JSON.stringify({ text: params.text }),
  })

  const response = await fetch(`${GRAPH_API}/me/messages?${query.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(25_000),
  })

  const data = await response.json().catch(() => ({})) as { message_id?: string; error?: { message?: string } }
  if (!response.ok || data.error) {
    return { ok: false, error: data.error?.message ?? `instagram_dm_failed:${response.status}` }
  }

  return { ok: true, messageId: data.message_id ?? null }
}

async function loadDeliveryText(
  supabase: ReturnType<typeof getAdminClient>,
  generatedContentId: string | null,
): Promise<string | null> {
  if (!generatedContentId) return null

  const { data } = await supabase
    .from('generated_content')
    .select('content')
    .eq('id', generatedContentId)
    .maybeSingle()

  if (!data?.content || typeof data.content !== 'string') return null
  const parsed = parseGeneratedContentJson(data.content)
  const giveaway = parsed?.giveaway as Record<string, unknown> | undefined
  const delivery = giveaway?.delivery as Record<string, unknown> | undefined
  return typeof delivery?.dmText === 'string' ? delivery.dmText : null
}

async function findMatchingLead(
  supabase: ReturnType<typeof getAdminClient>,
  workspaceId: string,
  fromId: string,
  messageText: string,
): Promise<GiveawayLeadRow | null> {
  const { data } = await supabase
    .from('instagram_giveaway_leads')
    .select('id, generated_content_id, keyword, status')
    .eq('workspace_id', workspaceId)
    .eq('commenter_ig_user_id', fromId)
    .in('status', ['commented', 'comment_replied', 'dm_received', 'qualified'])
    .order('requested_at', { ascending: false })
    .limit(10)

  for (const lead of data ?? []) {
    if (includesKeyword(messageText, lead.keyword as string)) {
      return lead as GiveawayLeadRow
    }
  }

  return null
}

export async function GET(req: NextRequest) { return handler(req) }
export async function POST(req: NextRequest) { return handler(req) }

async function handler(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = getAdminClient()
  const { data: pending } = await supabase
    .from('instagram_dm_interactions')
    .select('id, workspace_id, from_id, text, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(BATCH)

  const results: Array<{ id: number; status: string; error?: string }> = []

  for (const item of pending ?? []) {
    const { data: claimed } = await supabase
      .from('instagram_dm_interactions')
      .update({ status: 'processing' })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id')

    if (!claimed?.length) {
      results.push({ id: item.id, status: 'skipped_claimed' })
      continue
    }

    let matchedLeadId: string | null = null

    try {
      const lead = await findMatchingLead(supabase, item.workspace_id, item.from_id, item.text)
      if (!lead) {
        await supabase
          .from('instagram_dm_interactions')
          .update({
            status: 'ignored',
            last_error: 'no_matching_giveaway_lead_or_keyword',
            processed_at: new Date().toISOString(),
          })
          .eq('id', item.id)
        results.push({ id: item.id, status: 'ignored' })
        continue
      }
      matchedLeadId = lead.id

      const dmText = await loadDeliveryText(supabase, lead.generated_content_id)
      if (!dmText) {
        throw new Error('missing_giveaway_delivery_text')
      }

      await supabase
        .from('instagram_giveaway_leads')
        .update({
          status: 'qualified',
          dm_text: item.text,
          dm_received_at: new Date().toISOString(),
          qualified_at: new Date().toISOString(),
        })
        .eq('id', lead.id)

      const creds = await getInstagramCredentials(item.workspace_id)
      if (!creds.accessToken) {
        throw new Error('missing_instagram_access_token')
      }

      const sent = await sendInstagramDm({
        accessToken: creds.accessToken,
        recipientId: item.from_id,
        text: dmText,
      })

      if (!sent.ok) {
        throw new Error(sent.error)
      }

      await supabase
        .from('instagram_giveaway_leads')
        .update({
          status: 'delivered',
          delivered_message_id: sent.messageId,
          delivered_at: new Date().toISOString(),
          converted_at: new Date().toISOString(),
          conversion_event: 'dm_delivery',
          last_error: null,
        })
        .eq('id', lead.id)

      await supabase
        .from('instagram_dm_interactions')
        .update({
          status: 'processed',
          matched_lead_id: lead.id,
          last_error: null,
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id)

      results.push({ id: item.id, status: 'delivered' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (matchedLeadId) {
        await supabase
          .from('instagram_giveaway_leads')
          .update({
            status: 'failed',
            last_error: message,
          })
          .eq('id', matchedLeadId)
      }
      await supabase
        .from('instagram_dm_interactions')
        .update({
          status: 'failed',
          last_error: message,
          processed_at: new Date().toISOString(),
        })
        .eq('id', item.id)
      results.push({ id: item.id, status: 'failed', error: message })
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results })
}
