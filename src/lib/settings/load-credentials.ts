/**
 * Load platform credentials from workspaces.platform_credentials JSONB.
 *
 * ISOLATION RULE: account-specific fields (accessToken, userId, personUrn)
 * MUST come from the DB. Env var fallback for these fields causes
 * cross-workspace contamination in multi-workspace deployments.
 *
 * Only app-level / shared values (appId, API version) may fall back to env vars.
 *
 * See: fix commit 8d8690a — 94 posts cross-contaminated Brand Instagram
 * because INSTAGRAM_USER_ID env var was shared across all workspaces.
 */

import { getAdminClient } from '@/lib/supabase/admin'

interface CredentialSet {
  accessToken?: string
  personUrn?: string
  appId?: string
  userId?: string
  channelId?: string
  defaultTags?: string[]
  expiresAt?: string
  // Instagram via Facebook Graph (token EAA de System User/Page — não expira)
  pageAccessToken?: string
  igBusinessId?: string
}

type PlatformCredentials = Record<string, CredentialSet>

// 1-min cache per workspace (reduced from 5min to pick up credential updates faster)
const cache = new Map<string, { data: PlatformCredentials; loadedAt: number }>()
const CACHE_TTL = 60 * 1000

async function loadAll(workspaceId: string): Promise<PlatformCredentials> {
  const cached = cache.get(workspaceId)
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) return cached.data

  const supabase = getAdminClient()
  const { data } = await supabase
    .from('workspaces')
    .select('platform_credentials')
    .eq('id', workspaceId)
    .single()

  const creds = (data?.platform_credentials ?? {}) as PlatformCredentials
  cache.set(workspaceId, { data: creds, loadedAt: Date.now() })
  return creds
}

export function invalidateCredentialsCache(workspaceId: string) {
  cache.delete(workspaceId)
}

/**
 * Validate that all active platforms for a workspace have credentials configured.
 * Returns a list of platforms that are active but lack required credentials.
 * Used as a pre-flight check in the publisher to surface misconfiguration early.
 */
export async function checkCredentialHealth(
  workspaceId: string,
  activePlatforms: string[],
): Promise<{ platform: string; missing: string[] }[]> {
  const all = await loadAll(workspaceId)
  const issues: { platform: string; missing: string[] }[] = []

  for (const platform of activePlatforms) {
    const db = all[platform]
    if (platform === 'instagram') {
      const missing: string[] = []
      if (!db?.userId) missing.push('userId')
      if (!db?.accessToken) missing.push('accessToken')
      if (missing.length) issues.push({ platform, missing })
    } else if (platform === 'linkedin') {
      const missing: string[] = []
      if (!db?.accessToken) missing.push('accessToken')
      if (missing.length) issues.push({ platform, missing })
    }
    // x and youtube use env vars for auth (single-account) — not checked here
  }

  return issues
}

export async function getLinkedInCredentials(workspaceId: string): Promise<{ accessToken: string; personUrn?: string }> {
  const all = await loadAll(workspaceId)
  const db = all.linkedin

  // accessToken and personUrn are account-specific — no env var fallback.
  return {
    accessToken: db?.accessToken || '',
    personUrn: db?.personUrn || undefined,
  }
}

export async function getInstagramCredentials(workspaceId: string): Promise<{ appId: string; igUserId: string; accessToken: string }> {
  const all = await loadAll(workspaceId)
  const db = all.instagram

  // igUserId and accessToken are account-specific — NEVER fall back to env vars.
  // Env var fallback for these fields caused cross-workspace contamination (multiple workspaces
  // sharing the same INSTAGRAM_USER_ID env var would post to the wrong account).
  // appId is app-level (shared), so env var fallback is safe for it.

  // Preferir o token EAA (Facebook Page/System User) quando presente: ele NÃO expira
  // (debug_token => expires_at:0) e roda em graph.facebook.com com o Instagram
  // Business Account ID. O `accessToken` IGAA (graph.instagram.com) é long-lived de
  // ~60 dias, sem auto-refresh — quando expira, derruba reels/stories silenciosamente.
  // Ambos ficam no mesmo registro; aqui escolhemos sempre o permanente.
  if (db?.pageAccessToken && db?.igBusinessId) {
    return {
      appId: db?.appId || process.env.INSTAGRAM_APP_ID || '',
      igUserId: db.igBusinessId,
      accessToken: db.pageAccessToken,
    }
  }

  return {
    appId: db?.appId || process.env.INSTAGRAM_APP_ID || '',
    igUserId: db?.userId || '',
    accessToken: db?.accessToken || '',
  }
}

export async function getYouTubeCredentials(workspaceId: string): Promise<{
  channelId?: string
  defaultTags: string[]
  privacyStatus: 'private' | 'public' | 'unlisted'
}> {
  const all = await loadAll(workspaceId)
  const db = all.youtube
  const envTags = (process.env.YOUTUBE_DEFAULT_TAGS || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)

  const dbTags = Array.isArray(db?.defaultTags)
    ? db.defaultTags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : []

  const privacyStatus = (process.env.YOUTUBE_PRIVACY_STATUS || 'public').toLowerCase()
  const safePrivacyStatus = privacyStatus === 'private' || privacyStatus === 'unlisted'
    ? privacyStatus
    : 'public'

  return {
    channelId: db?.channelId || process.env.YOUTUBE_CHANNEL_ID,
    defaultTags: dbTags.length > 0 ? dbTags : envTags,
    privacyStatus: safePrivacyStatus,
  }
}
