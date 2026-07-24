/**
 * Feedback loop — port of v1's build-feedback-guardrails.ts.
 * Reads recent eval entries and builds prompt injection blocks
 * for agents to learn from past mistakes and successes.
 */

import { getAdminClient } from '@/lib/supabase/admin'

interface FeedbackBlock {
  avoid: string[]
  follow: string[]
  summary: string
}

/**
 * Build feedback guardrails for a specific agent.
 * Reads recent eval_dataset entries and constructs:
 * - AVOID patterns (from rejected/low-score entries)
 * - FOLLOW patterns (from high-score entries)
 *
 * Time-weighted: recent issues weigh more than old ones.
 */
export async function buildFeedbackGuardrails(
  workspaceId: string,
  agentSlug: string,
  daysBack = 14
): Promise<string> {
  const supabase = getAdminClient()
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString()

  const { data: evals } = await supabase
    .from('eval_dataset')
    .select('auto_score, verdict, issues, feedback, created_at')
    .eq('workspace_id', workspaceId)
    .eq('agent_slug', agentSlug)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(50)

  if (!evals?.length) return ''

  const block = buildBlock(evals as Parameters<typeof buildBlock>[0])

  if (block.avoid.length === 0 && block.follow.length === 0) return ''

  const lines: string[] = ['# Feedback de Qualidade (auto-aprendizado)']

  if (block.avoid.length > 0) {
    lines.push('', '## EVITE estes padrões (erros recentes):')
    for (const issue of block.avoid.slice(0, 5)) {
      lines.push(`- ${issue}`)
    }
  }

  if (block.follow.length > 0) {
    lines.push('', '## SIGA estes padrões (pontuações altas):')
    for (const pattern of block.follow.slice(0, 5)) {
      lines.push(`- ${pattern}`)
    }
  }

  lines.push('', `_Baseado em ${evals.length} avaliações dos últimos ${daysBack} dias._`)

  return lines.join('\n')
}

function buildBlock(
  evals: Array<{
    auto_score: number | null
    verdict: string | null
    issues: string[] | null
    feedback: string | null
    created_at: string
  }>
): FeedbackBlock {
  const now = Date.now()

  // Collect issues with time-weighted frequency
  const issueWeights: Record<string, number> = {}
  const positivePatterns: Record<string, number> = {}

  for (const entry of evals) {
    const ageHours = (now - new Date(entry.created_at).getTime()) / (1000 * 60 * 60)
    const recencyWeight = Math.max(0.1, 1 - ageHours / (14 * 24)) // Decay over 14 days

    // Negative: collect issues from rejected/low-score entries
    if (entry.verdict === 'reject' || (entry.auto_score && entry.auto_score < 5)) {
      for (const issue of entry.issues ?? []) {
        issueWeights[issue] = (issueWeights[issue] ?? 0) + recencyWeight
      }
      if (entry.feedback) {
        issueWeights[entry.feedback] = (issueWeights[entry.feedback] ?? 0) + recencyWeight * 0.5
      }
    }

    // Positive: collect patterns from high-score entries
    if (entry.auto_score && entry.auto_score >= 8) {
      if (entry.feedback) {
        positivePatterns[entry.feedback] = (positivePatterns[entry.feedback] ?? 0) + recencyWeight
      }
    }
  }

  // Sort by weight, take top entries
  const avoid = Object.entries(issueWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([issue]) => issue)

  const follow = Object.entries(positivePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([pattern]) => pattern)

  return {
    avoid,
    follow,
    summary: `${avoid.length} patterns to avoid, ${follow.length} patterns to follow`,
  }
}
