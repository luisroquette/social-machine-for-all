import { getAdminClient } from '@/lib/supabase/admin'
import { parseGeneratedContentJson } from '@/lib/trends/trend-giveaway'

export interface TrendGiveawayContext {
  generatedContentId: string
  trendVideoJobId: string | null
  keyword: string
  commentReply: string
}

export async function findTrendGiveawayForMedia(
  supabase: ReturnType<typeof getAdminClient>,
  mediaId: string | null,
): Promise<TrendGiveawayContext | null> {
  if (!mediaId) return null

  const { data } = await supabase
    .from('generated_content')
    .select('id, content')
    .eq('target_platform', 'instagram')
    .eq('status', 'published')
    .eq('published_id', mediaId)
    .order('published_at', { ascending: false })
    .limit(1)

  const row = data?.[0]
  if (!row?.content || typeof row.content !== 'string') return null

  const parsed = parseGeneratedContentJson(row.content)
  if (!parsed || parsed.type !== 'trend_video') return null

  const giveaway = parsed.giveaway as Record<string, unknown> | undefined
  const delivery = giveaway?.delivery as Record<string, unknown> | undefined
  if (!giveaway || !delivery) return null

  const keyword = typeof giveaway.keyword === 'string' ? giveaway.keyword : ''
  const commentReply = typeof delivery.commentReply === 'string' ? delivery.commentReply : ''
  if (!keyword || !commentReply) return null

  return {
    generatedContentId: row.id as string,
    trendVideoJobId: typeof giveaway.jobId === 'string' ? giveaway.jobId : null,
    keyword,
    commentReply,
  }
}

export async function upsertGiveawayLead(params: {
  supabase: ReturnType<typeof getAdminClient>
  workspaceId: string
  generatedContentId: string
  trendVideoJobId: string | null
  commentInteractionId?: number | null
  instagramMediaId?: string | null
  commenterIgUserId: string
  commenterUsername?: string | null
  keyword: string
  commentText?: string | null
  status: 'commented' | 'comment_replied' | 'qualified' | 'delivered' | 'failed'
  repliedAt?: string | null
  commentReplyText?: string | null
  followRequestedAt?: string | null
  dmText?: string | null
  dmReceivedAt?: string | null
  qualifiedAt?: string | null
  deliveredAt?: string | null
  deliveredMessageId?: string | null
  convertedAt?: string | null
  conversionEvent?: string | null
  lastError?: string | null
}) {
  const payload = {
    workspace_id: params.workspaceId,
    generated_content_id: params.generatedContentId,
    trend_video_job_id: params.trendVideoJobId,
    comment_interaction_id: params.commentInteractionId ?? null,
    instagram_media_id: params.instagramMediaId ?? null,
    commenter_ig_user_id: params.commenterIgUserId,
    commenter_username: params.commenterUsername ?? null,
    keyword: params.keyword,
    comment_text: params.commentText ?? null,
    status: params.status,
    replied_at: params.repliedAt ?? null,
    comment_reply_text: params.commentReplyText ?? null,
    follow_requested_at: params.followRequestedAt ?? null,
    dm_text: params.dmText ?? null,
    dm_received_at: params.dmReceivedAt ?? null,
    qualified_at: params.qualifiedAt ?? null,
    delivered_at: params.deliveredAt ?? null,
    delivered_message_id: params.deliveredMessageId ?? null,
    converted_at: params.convertedAt ?? null,
    conversion_event: params.conversionEvent ?? null,
    last_error: params.lastError ?? null,
  }

  try {
    await params.supabase.from('instagram_giveaway_leads').upsert(payload, {
      onConflict: 'workspace_id,generated_content_id,commenter_ig_user_id',
    })
  } catch {
    // Safe rollout while conversion columns are still being migrated.
    await params.supabase.from('instagram_giveaway_leads').upsert({
      workspace_id: params.workspaceId,
      generated_content_id: params.generatedContentId,
      trend_video_job_id: params.trendVideoJobId,
      comment_interaction_id: params.commentInteractionId ?? null,
      instagram_media_id: params.instagramMediaId ?? null,
      commenter_ig_user_id: params.commenterIgUserId,
      commenter_username: params.commenterUsername ?? null,
      keyword: params.keyword,
      comment_text: params.commentText ?? null,
      dm_text: params.dmText ?? null,
      status: params.status,
      replied_at: params.repliedAt ?? null,
      dm_received_at: params.dmReceivedAt ?? null,
      qualified_at: params.qualifiedAt ?? null,
      delivered_at: params.deliveredAt ?? null,
      delivered_message_id: params.deliveredMessageId ?? null,
      last_error: params.lastError ?? null,
    }, {
      onConflict: 'workspace_id,generated_content_id,commenter_ig_user_id',
    })
  }
}
