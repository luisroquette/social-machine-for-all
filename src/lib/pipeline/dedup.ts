/**
 * Content deduplication using keyword fingerprinting + Jaccard similarity.
 * Ported from Social Machine v1's x-api-helpers.ts.
 */

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'and', 'but', 'or', 'if', 'while', 'because', 'until', 'although',
  'this', 'that', 'these', 'those', 'it', 'its', 'he', 'she', 'they',
  'we', 'you', 'i', 'me', 'my', 'your', 'his', 'her', 'our', 'their',
  // Portuguese stopwords
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da',
  'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'com',
  'sem', 'sob', 'sobre', 'entre', 'e', 'ou', 'mas', 'que', 'se', 'como',
  'mais', 'menos', 'muito', 'pouco', 'bem', 'mal', 'não', 'sim', 'já',
  'ainda', 'também', 'só', 'é', 'são', 'foi', 'ser', 'estar', 'ter',
  'fazer', 'poder', 'dever', 'ir', 'vir', 'dar', 'ver', 'saber',
])

/**
 * Extract top keywords from text, removing URLs, mentions, stopwords.
 * Returns lowercase sorted unique terms.
 */
export function extractKeywordFingerprint(text: string, maxTerms = 12): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '') // Remove URLs
    .replace(/@\w+/g, '')           // Remove @mentions
    .replace(/#\w+/g, '')           // Remove hashtags
    .replace(/[^\w\sáéíóúâêîôûãõçàèìòù]/g, ' ') // Remove punctuation
    .replace(/\s+/g, ' ')
    .trim()

  const words = cleaned.split(' ')
    .filter(w => w.length > 2 && !STOPWORDS.has(w))

  // Count frequency
  const freq: Record<string, number> = {}
  for (const w of words) {
    freq[w] = (freq[w] ?? 0) + 1
  }

  // Return top N by frequency
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTerms)
    .map(([word]) => word)
    .sort()
}

/**
 * Jaccard similarity between two keyword fingerprints.
 * Returns 0-1 (0 = no overlap, 1 = identical).
 */
export function fingerprintSimilarity(fp1: string[], fp2: string[]): number {
  if (fp1.length === 0 && fp2.length === 0) return 1
  if (fp1.length === 0 || fp2.length === 0) return 0

  const set1 = new Set(fp1)
  const set2 = new Set(fp2)

  let intersection = 0
  for (const term of set1) {
    if (set2.has(term)) intersection++
  }

  const union = set1.size + set2.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Check if content is a duplicate of any existing content.
 * Returns the matching content ID if duplicate, null otherwise.
 */
export function findDuplicate(
  newFingerprint: string[],
  existingItems: Array<{ id: string; fingerprint: string[] }>,
  threshold = 0.5
): string | null {
  for (const item of existingItems) {
    const similarity = fingerprintSimilarity(newFingerprint, item.fingerprint)
    if (similarity >= threshold) {
      return item.id
    }
  }
  return null
}

import { getAdminClient } from '@/lib/supabase/admin'

/**
 * Check if a curated content item is a duplicate of recently curated content.
 * Looks at curated_content from the last 48 hours in the same workspace.
 */
export async function isDuplicateCuratedContent(
  workspaceId: string,
  sourceContent: string,
  threshold = 0.5
): Promise<{ isDuplicate: boolean; matchId?: string; similarity?: number }> {
  const supabase = getAdminClient()
  const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  const { data: existing } = await supabase
    .from('curated_content')
    .select('id, keyword_fingerprint')
    .eq('workspace_id', workspaceId)
    .gte('created_at', twoDaysAgo)

  if (!existing?.length) return { isDuplicate: false }

  const newFp = extractKeywordFingerprint(sourceContent)

  for (const item of existing) {
    const existingFp = (item.keyword_fingerprint as string[]) ?? []
    if (existingFp.length === 0) continue

    const similarity = fingerprintSimilarity(newFp, existingFp)
    if (similarity >= threshold) {
      return { isDuplicate: true, matchId: item.id as string, similarity }
    }
  }

  return { isDuplicate: false }
}

/**
 * Check if a generated content draft already exists for a curated content item.
 */
export async function hasDraftForCuratedItem(
  workspaceId: string,
  curatedContentId: string,
  platform?: string
): Promise<boolean> {
  const supabase = getAdminClient()

  let query = supabase
    .from('generated_content')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('curated_content_id', curatedContentId)

  if (platform) {
    query = query.eq('target_platform', platform)
  }

  const { count } = await query

  return (count ?? 0) > 0
}
