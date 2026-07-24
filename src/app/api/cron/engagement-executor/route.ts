export const maxDuration = 30

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/database.types'
import { WORKSPACE_ID } from '@/lib/config/workspace'
import { XClient } from '@/lib/platforms/x/client'
import { searchTweetsIO } from '@/lib/platforms/x/twitterapi-io'
import { getVariable, loadSettings } from '@/lib/settings/load-settings'
import { parseHandleList } from '@/lib/agents/engagement-own/loop-guardrails'
import { BUILTIN_OWNED_X_HANDLES } from '@/lib/engagement-profiles/same-owner'

const MAX_PER_RUN = 10

// Quiet hours: 00:00–08:00 UTC (matches engagement agent operating hours)
function isQuietHours(): boolean {
  const hour = new Date().getUTCHours()
  return hour >= 0 && hour < 8
}

// Extract tweet ID from a published_url like https://x.com/user/status/123456789
function extractTweetId(url: string): string | null {
  const match = url.match(/\/status\/(\d+)/)
  return match ? match[1] : null
}

function mergeMetadata(
  existing: Record<string, unknown> | null | undefined,
  patch: Record<string, unknown>
): Json {
  return {
    ...(existing ?? {}),
    ...patch,
  } as Json
}

/**
 * Engagement executor — processes pending engagement_actions queue.
 * Runs every 30 minutes, picks up to MAX_PER_RUN actions, executes platform API calls.
 */
export async function GET(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (isQuietHours()) {
    return NextResponse.json({ ok: true, skipped: 'quiet hours' })
  }

  const supabase = getAdminClient()

  const { data: actions, error } = await supabase
    .from('engagement_actions')
    .select('id, action_type, target_platform, target_url, target_author, comment_text, metadata')
    .eq('workspace_id', WORKSPACE_ID)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    console.error('[engagement-executor] DB error:', error.message)
    return NextResponse.json({ error: 'DB error', details: error.message }, { status: 500 })
  }

  if (!actions || actions.length === 0) {
    return NextResponse.json({ ok: true, executed: 0, failed: 0, skipped: 0 })
  }

  // GUARDRAIL PERMANENTE: carregar todos os handles protegidos da operação.
  // Defesa em profundidade — mesmo que algum agente enfileire por engano, o executor cancela.
  const settings = await loadSettings(WORKSPACE_ID)
  const [primaryTwitterHandle, ownedHandlesCsv] = await Promise.all([
    getVariable(WORKSPACE_ID, 'twitter_handle'),
    getVariable(WORKSPACE_ID, 'owned_x_handles'),
  ])
  const protectedHandles = parseHandleList(
    settings.own_twitter_handle,
    settings.target_handle,
    primaryTwitterHandle,
    ownedHandlesCsv,
    BUILTIN_OWNED_X_HANDLES.join(','),
  )

  const xClient = XClient.fromEnv()
  let executed = 0
  let failed = 0
  let skipped = 0

  for (const action of actions) {
    // GUARDRAIL PERMANENTE: nunca executar ação direcionada a handles da própria operação
    const targetUrl = (action.target_url ?? '').toLowerCase()
    const targetAuthor = (action.target_author ?? '').replace(/^@/, '').trim().toLowerCase()
    const sameOwnerTarget = (targetAuthor && protectedHandles.has(targetAuthor))
      || Array.from(protectedHandles).some(handle => targetUrl.includes(`/${handle}/`))

    if (sameOwnerTarget) {
      await supabase
        .from('engagement_actions')
        .update({
          status: 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(action.metadata as Record<string, unknown> | null, {
            reason: `same-owner engagement bloqueado pelo executor: target_author/url pertence à operação (${Array.from(protectedHandles).join(', ')})`,
          }),
        })
        .eq('id', action.id)
      failed++
      continue
    }
    const platform = (action.target_platform ?? '').toLowerCase()

    // Instagram engagement is not executable via Graph API for external accounts
    if (platform === 'instagram') {
      await supabase
        .from('engagement_actions')
        .update({
          status: 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(action.metadata as Record<string, unknown> | null, {
            reason: 'Instagram external engagement not supported via Graph API',
          }),
        })
        .eq('id', action.id)
      skipped++
      failed++
      continue
    }

    if (platform !== 'twitter' && platform !== 'x') {
      await supabase
        .from('engagement_actions')
        .update({
          status: 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(action.metadata as Record<string, unknown> | null, {
            reason: `Platform not supported: ${platform}`,
          }),
        })
        .eq('id', action.id)
      skipped++
      failed++
      continue
    }

    // Resolve tweet ID: from target_url (own or external content stored by agent)
    // or fall back to searching the author's latest tweet (legacy null-url actions)
    let tweetId: string | null = null

    if (action.target_url) {
      tweetId = extractTweetId(action.target_url)
    }

    if (!tweetId && action.target_author) {
      const handle = action.target_author.replace(/^@/, '')
      const results = await searchTweetsIO(`from:${handle} -is:retweet -is:reply`, 1)
      tweetId = results?.[0]?.id ?? null
    }

    if (!tweetId) {
      await supabase
        .from('engagement_actions')
        .update({
          status: 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(action.metadata as Record<string, unknown> | null, {
            reason: 'Could not resolve tweet ID',
            target_url: action.target_url,
            target_author: action.target_author,
          }),
        })
        .eq('id', action.id)
      failed++
      continue
    }

    // Execute the platform action
    if (action.action_type === 'like') {
      const liked = await xClient.like(tweetId)
      await supabase
        .from('engagement_actions')
        .update({
          status: liked ? 'executed' : 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(
            action.metadata as Record<string, unknown> | null,
            liked ? { tweet_id: tweetId } : { error: 'like failed' }
          ),
        })
        .eq('id', action.id)
      if (liked) executed++; else failed++
      continue
    }

    if (action.action_type === 'retweet') {
      const retweeted = await xClient.retweet(tweetId)
      await supabase
        .from('engagement_actions')
        .update({
          status: retweeted ? 'executed' : 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(
            action.metadata as Record<string, unknown> | null,
            retweeted ? { tweet_id: tweetId } : { error: 'retweet failed' }
          ),
        })
        .eq('id', action.id)
      if (retweeted) executed++; else failed++
      continue
    }

    // comment or like_and_comment
    if (action.action_type === 'like_and_comment') {
      // best-effort like before commenting
      await xClient.like(tweetId).catch(() => null)
    }

    const commentText = action.comment_text ?? ''
    const result = await xClient.reply(tweetId, commentText)

    if (result.success) {
      await supabase
        .from('engagement_actions')
        .update({
          status: 'executed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(action.metadata as Record<string, unknown> | null, {
            post_url: result.postUrl,
            post_id: result.postId,
          }),
        })
        .eq('id', action.id)
      executed++
    } else {
      await supabase
        .from('engagement_actions')
        .update({
          status: 'failed',
          executed_at: new Date().toISOString(),
          metadata: mergeMetadata(action.metadata as Record<string, unknown> | null, {
            error: result.error,
          }),
        })
        .eq('id', action.id)
      failed++
    }
  }

  console.log(`[engagement-executor] executed=${executed} failed=${failed} skipped=${skipped}`)
  return NextResponse.json({ ok: true, executed, failed, skipped })
}
