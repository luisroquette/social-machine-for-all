import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase/admin'
import { verifySignature, extractComments, extractMessages, isKeywordCta, shouldSkip, verifyChallenge } from '@/lib/platforms/instagram/webhook-utils'
import { findTrendGiveawayForMedia, upsertGiveawayLead } from '@/lib/platforms/instagram/giveaway-leads'

// Endpoint público — chamado diretamente pela Meta. Não pode ter JWT auth.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface WorkspaceRow {
  id: string
  name: string
  updated_at: string | null
  platform_credentials: Record<string, {
    accessToken?: string
    pageAccessToken?: string
    igBusinessId?: string
    userId?: string
  }> | null
}

function getInstagramTargetId(workspace: WorkspaceRow): string {
  const creds = workspace.platform_credentials?.instagram
  return creds?.igBusinessId ?? creds?.userId ?? ''
}

function scoreInstagramWorkspace(workspace: WorkspaceRow): number {
  const creds = workspace.platform_credentials?.instagram
  if (!creds) return 0

  let score = 0
  if (creds.accessToken) score += 4
  if (creds.pageAccessToken) score += 3
  if (creds.igBusinessId) score += 2
  if (creds.userId && creds.igBusinessId && creds.userId === creds.igBusinessId) score += 1
  return score
}

function pickBestWorkspace(current: WorkspaceRow | undefined, candidate: WorkspaceRow): WorkspaceRow {
  if (!current) return candidate

  const currentScore = scoreInstagramWorkspace(current)
  const candidateScore = scoreInstagramWorkspace(candidate)
  if (candidateScore !== currentScore) {
    return candidateScore > currentScore ? candidate : current
  }

  const currentUpdatedAt = current.updated_at ? Date.parse(current.updated_at) : 0
  const candidateUpdatedAt = candidate.updated_at ? Date.parse(candidate.updated_at) : 0
  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current
}

// GET: handshake de verificação do webhook (Meta confirma URL antes de enviar eventos)
export async function GET(req: NextRequest) {
  const challenge = verifyChallenge(
    req.nextUrl.searchParams,
    process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? '',
  )
  if (!challenge) return new NextResponse('Forbidden', { status: 403 })
  return new NextResponse(challenge, { status: 200 })
}

// POST: eventos de comentário enviados pela Meta
export async function POST(req: NextRequest) {
  const appSecret = process.env.INSTAGRAM_APP_SECRET ?? ''
  const raw = await req.text()

  const valid = await verifySignature(raw, req.headers.get('x-hub-signature-256'), appSecret)
  if (!valid) return NextResponse.json({ error: 'invalid signature' }, { status: 401 })

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  // Roteamento multi-workspace: identifica qual workspace por igBusinessId
  const supabase = getAdminClient()
  const { data: workspaces } = await supabase
    .from('workspaces')
    .select('id, name, updated_at, platform_credentials')
    .eq('active', true)

  const p = payload as { entry?: Array<{ id?: string }> }
  const entryIds = new Set((p.entry ?? []).map(e => e.id).filter(Boolean))
  const routes = new Map<string, WorkspaceRow>()

  for (const rawWorkspace of workspaces ?? []) {
    const ws = rawWorkspace as WorkspaceRow
    const igId = getInstagramTargetId(ws)
    if (!igId) continue
    routes.set(igId, pickBestWorkspace(routes.get(igId), ws))
  }

  // Optionally forward entries that do not belong to a local workspace.
  // No destination is bundled with the public template.
  const foreignEntryIds = [...entryIds].filter((id): id is string => !!id && !routes.has(id))
  const fallbackWebhookUrl = process.env.INSTAGRAM_FALLBACK_WEBHOOK_URL
  if (foreignEntryIds.length > 0 && fallbackWebhookUrl) {
    fetch(fallbackWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': req.headers.get('x-hub-signature-256') ?? '',
      },
      body: raw,
    }).catch(() => {})
  }

  let enqueued = 0
  let dmEnqueued = 0

  for (const [igId, ws] of routes.entries()) {
    if (!entryIds.has(igId)) continue

    const comments = extractComments(payload, igId)
    const giveawayByMediaId = new Map<string, Awaited<ReturnType<typeof findTrendGiveawayForMedia>>>()
    for (const c of comments) {
      const { skip } = shouldSkip(c, igId)
      if (skip) continue
      const { error } = await supabase.from('instagram_comment_interactions').upsert(
        {
          comment_id: c.comment_id,
          workspace_id: ws.id,
          media_id: c.media_id,
          parent_id: c.parent_id,
          from_id: c.from_id,
          from_username: c.from_username,
          text: c.text,
          status: 'pending',
        },
        { onConflict: 'comment_id', ignoreDuplicates: true },
      )
      if (!error) {
        enqueued++

        if (c.media_id && isKeywordCta(c.text)) {
          const giveawayContext = giveawayByMediaId.has(c.media_id)
            ? giveawayByMediaId.get(c.media_id) ?? null
            : await findTrendGiveawayForMedia(supabase, c.media_id)
          if (!giveawayByMediaId.has(c.media_id)) {
            giveawayByMediaId.set(c.media_id, giveawayContext)
          }

          if (giveawayContext) {
            try {
              await upsertGiveawayLead({
                supabase,
                workspaceId: ws.id,
                generatedContentId: giveawayContext.generatedContentId,
                trendVideoJobId: giveawayContext.trendVideoJobId,
                instagramMediaId: c.media_id,
                commenterIgUserId: c.from_id,
                commenterUsername: c.from_username,
                keyword: giveawayContext.keyword,
                commentText: c.text,
                status: 'commented',
              })
            } catch {
              // Safe rollout: não quebra o webhook público.
            }
          }
        }
      }
    }
  }

  for (const [igId, ws] of routes.entries()) {
    if (!entryIds.has(igId)) continue

    const messages = extractMessages(payload, igId)
    for (const message of messages) {
      try {
        const { error } = await supabase.from('instagram_dm_interactions').upsert(
          {
            message_id: message.message_id,
            workspace_id: ws.id,
            from_id: message.from_id,
            to_id: message.to_id,
            text: message.text,
            status: 'pending',
          },
          { onConflict: 'message_id', ignoreDuplicates: true },
        )
        if (!error) dmEnqueued++
      } catch {
        // Safe rollout: if the migration is not applied yet, keep comments webhook working.
      }
    }
  }

  // Nudge fire-and-forget — não bloqueia resposta para a Meta (que re-tenta se não-200)
  if (enqueued > 0) {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://social-machine-v31.vercel.app'
    fetch(`${base}/api/cron/instagram-comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ triggered_by: 'webhook' }),
    }).catch(() => {})
  }

  if (dmEnqueued > 0) {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://social-machine-v31.vercel.app'
    fetch(`${base}/api/cron/instagram-giveaway-delivery`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ triggered_by: 'webhook_dm' }),
    }).catch(() => {})
  }

  return NextResponse.json({ received: true, enqueued, dmEnqueued })
}
