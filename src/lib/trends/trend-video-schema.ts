import { SupabaseClient } from '@supabase/supabase-js'
import type { Json } from '@/lib/supabase/database.types'

let generationMemorySupportCache: boolean | null = null

export async function supportsTrendVideoGenerationMemory(
  supabase: SupabaseClient,
): Promise<boolean> {
  if (generationMemorySupportCache !== null) return generationMemorySupportCache

  const { error } = await supabase
    .from('trend_video_jobs')
    .select('generation_memory')
    .limit(1)

  generationMemorySupportCache = error?.code !== '42703'
  return generationMemorySupportCache
}

export function withOptionalTrendVideoGenerationMemory<T extends Record<string, unknown>>(
  payload: T,
  enabled: boolean,
  generationMemory: Record<string, unknown>,
): T & { generation_memory?: Json } {
  if (!enabled) return payload
  return {
    ...payload,
    generation_memory: generationMemory as Json,
  }
}
