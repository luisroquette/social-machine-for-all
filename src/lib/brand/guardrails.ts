/**
 * Output compliance guardrails.
 * Forbidden patterns loaded from DB (workspace_settings) with hardcoded fallback.
 */

import { getAdminClient } from '@/lib/supabase/admin'

// Fallback patterns if DB is unavailable
const DEFAULT_PATTERNS = [
  'como um modelo de linguagem', 'como uma IA', 'como um assistente', 'como um chatbot',
  'não tenho opiniões', 'não possuo sentimentos', 'meu treinamento foi cortado',
  'com certeza vai', 'com certeza será', 'resultado garantido',
  '100% de chance', '100% de certeza', 'garantimos o', 'garantimos que',
  'acabei de ler', 'acabei de ver', 'acabei de testar', 'acabei de descobrir',
  'é impressionante', 'é incrível', 'é enorme', 'é revolucionário', 'é fascinante', 'é surpreendente',
  'o impacto é', 'o impacto será', 'o futuro é', 'o futuro será', 'o futuro do', 'o futuro da',
  'isso pode mudar', 'isso vai mudar', 'isso pode revolucionar', 'isso vai transformar',
]

// Cache with 5-min TTL
let cachedPatterns: { patterns: string[]; loadedAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

/**
 * Load forbidden patterns from DB, with cache.
 */
async function loadPatterns(workspaceId?: string): Promise<string[]> {
  if (cachedPatterns && (Date.now() - cachedPatterns.loadedAt) < CACHE_TTL) {
    return cachedPatterns.patterns
  }

  if (!workspaceId) return DEFAULT_PATTERNS

  try {
    const supabase = getAdminClient()
    const { data } = await supabase
      .from('workspace_settings')
      .select('value')
      .eq('workspace_id', workspaceId)
      .eq('key', 'forbidden_patterns')
      .single()

    if (data?.value) {
      const patterns = (data.value as string).split('|').map(p => p.trim()).filter(Boolean)
      cachedPatterns = { patterns, loadedAt: Date.now() }
      return patterns
    }
  } catch {
    // Fall through to defaults
  }

  return DEFAULT_PATTERNS
}

/**
 * Remove forbidden patterns from generated text.
 */
export async function applyGuardrails(text: string, workspaceId?: string): Promise<string> {
  const patterns = await loadPatterns(workspaceId)
  let cleaned = text

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gi')
    cleaned = cleaned.replace(regex, '')
  }

  // Also remove hashtags (always forbidden)
  cleaned = cleaned.replace(/#\w+/g, '')

  // Clean up double spaces and empty lines
  cleaned = cleaned.replace(/  +/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  return cleaned
}

/**
 * Check if text contains any forbidden patterns.
 */
export async function checkGuardrails(text: string, workspaceId?: string): Promise<string[]> {
  const patterns = await loadPatterns(workspaceId)
  const violations: string[] = []

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gi')
    const match = text.match(regex)
    if (match) {
      violations.push(match[0])
    }
  }

  // Check hashtags
  const hashtagMatch = text.match(/#\w+/)
  if (hashtagMatch) violations.push(hashtagMatch[0])

  return violations
}

/**
 * Sync version for quick checks (uses cache or defaults).
 * Pass allowHashtags=true to skip the hashtag violation check (e.g., Instagram).
 */
export function checkGuardrailsSync(text: string, opts?: { allowHashtags?: boolean }): string[] {
  const patterns = cachedPatterns?.patterns ?? DEFAULT_PATTERNS
  const violations: string[] = []

  for (const pattern of patterns) {
    const regex = new RegExp(pattern, 'gi')
    const match = text.match(regex)
    if (match) violations.push(match[0])
  }

  if (!opts?.allowHashtags && /#\w+/.test(text)) violations.push('#hashtag')

  return violations
}
