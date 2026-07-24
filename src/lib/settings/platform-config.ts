/**
 * Load platform-specific configuration from database.
 */

import { getAdminClient } from '@/lib/supabase/admin'

export interface PlatformConfig {
  platform: string
  maxLength: number
  allowHashtags: boolean
  maxHashtags: number
  allowEmojis: boolean
  requireImage: boolean
  tone: string
  styleGuide: string
  engagementStyle: string
  hashtagStrategy: string
  active: boolean
}

// Cache with 5-min TTL
let cache: { configs: PlatformConfig[]; workspaceId: string; loadedAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function loadPlatformConfigs(workspaceId: string): Promise<PlatformConfig[]> {
  if (cache && cache.workspaceId === workspaceId && (Date.now() - cache.loadedAt) < CACHE_TTL) {
    return cache.configs
  }

  const supabase = getAdminClient()
  const { data } = await supabase
    .from('platform_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('active', true)

  const configs: PlatformConfig[] = ((data ?? []) as Array<Record<string, unknown>>).map(row => ({
    platform: row.platform as string,
    maxLength: row.max_length as number,
    allowHashtags: row.allow_hashtags as boolean,
    maxHashtags: row.max_hashtags as number,
    allowEmojis: row.allow_emojis as boolean,
    requireImage: row.require_image as boolean,
    tone: (row.tone as string) ?? '',
    styleGuide: (row.style_guide as string) ?? '',
    engagementStyle: (row.engagement_style as string) ?? '',
    hashtagStrategy: (row.hashtag_strategy as string) ?? '',
    active: row.active as boolean,
  }))

  cache = { configs, workspaceId, loadedAt: Date.now() }
  return configs
}

export async function getPlatformConfig(workspaceId: string, platform: string): Promise<PlatformConfig | null> {
  const configs = await loadPlatformConfigs(workspaceId)
  return configs.find(c => c.platform === platform) ?? null
}

export async function getActivePlatforms(workspaceId: string): Promise<string[]> {
  const configs = await loadPlatformConfigs(workspaceId)
  return configs.filter(c => c.active).map(c => c.platform)
}
