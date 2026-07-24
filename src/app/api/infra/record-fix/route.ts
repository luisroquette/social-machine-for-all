import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { WORKSPACE_ID } from '@/lib/config/workspace'

/**
 * POST /api/infra/record-fix
 *
 * Grava uma memória de fix de infraestrutura no soul dos agentes.
 * Chamado automaticamente pelo pre-push hook (fix: commits) ou manualmente pelo Claude Code.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}
 *
 * Body:
 *   agents      string[]   slugs dos agentes a notificar (ex: ['editor-in-chief', 'publisher'])
 *               use ['*'] para notificar todos os agentes ativos
 *   summary     string     descrição humana do fix (o que foi corrigido e por quê)
 *   root_cause  string?    causa raiz do problema (para diagnósticos futuros)
 *   context     object?    metadados estruturados (ex: arquivos alterados, commit hash)
 *   category    string?    'insight' | 'pattern' | 'warning' | 'preference' (default: 'warning')
 */

const VALID_CATEGORIES = ['insight', 'pattern', 'warning', 'preference'] as const
type Category = typeof VALID_CATEGORIES[number]

const ALL_AGENT_SLUGS = [
  'editor-in-chief',
  'curator',
  'writer',
  'reviewer',
  'publisher',
  'monitor',
  'engagement-own',
  'engagement-external',
  'seo-strategist',
  'performance-analyst',
  'ad-manager',
]

export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { agents, summary, root_cause, context, category } = body as {
    agents?: unknown
    summary?: unknown
    root_cause?: unknown
    context?: unknown
    category?: unknown
  }

  // Validate
  if (!summary || typeof summary !== 'string' || summary.trim().length < 10) {
    return NextResponse.json({ error: 'summary is required (min 10 chars)' }, { status: 400 })
  }
  if (!agents || !Array.isArray(agents) || agents.length === 0) {
    return NextResponse.json({ error: 'agents must be a non-empty array (use ["*"] for all)' }, { status: 400 })
  }

  const resolvedCategory: Category = VALID_CATEGORIES.includes(category as Category)
    ? (category as Category)
    : 'warning'

  const targetSlugs: string[] = agents.includes('*')
    ? ALL_AGENT_SLUGS
    : (agents as string[]).filter(a => typeof a === 'string')

  if (targetSlugs.length === 0) {
    return NextResponse.json({ error: 'No valid agent slugs provided' }, { status: 400 })
  }

  const resolvedContext = context && typeof context === 'object' ? context : {}
  const resolvedRootCause = root_cause && typeof root_cause === 'string' ? root_cause.trim() : undefined

  // Monta o conteúdo: summary + root_cause se presente
  const content = resolvedRootCause
    ? `${summary.trim()}\n\nCausa raiz: ${resolvedRootCause}`
    : summary.trim()

  const supabase = getAdminClient()
  const rows = targetSlugs.map(slug => ({
    workspace_id: WORKSPACE_ID,
    agent_slug: slug,
    category: resolvedCategory,
    content,
    context: {
      ...resolvedContext as object,
      _recorded_at: new Date().toISOString(),
      _source: (resolvedContext as Record<string, unknown>)?.auto ? 'pre-push-hook' : 'claude-code-deploy',
    },
    shared: true,
    relevance_score: 10,
  }))

  const { data, error } = await supabase
    .from('agent_memories')
    .insert(rows)
    .select('id, agent_slug')

  if (error) {
    console.error('[record-fix] DB insert failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Relevância 10, decai 0.5/semana → expira em ~16 semanas
  const RELEVANCE_START = 10
  const DECAY_PER_WEEK = 0.5
  const MIN_RELEVANCE = 2
  const weeksUntilExpiry = Math.floor((RELEVANCE_START - MIN_RELEVANCE) / DECAY_PER_WEEK)

  console.log(`[record-fix] Recorded fix for ${targetSlugs.length} agent(s): ${summary.slice(0, 80)}`)
  return NextResponse.json({
    ok: true,
    recorded: data?.length ?? 0,
    agents: targetSlugs,
    memory_expires_in_weeks: weeksUntilExpiry,
  })
}
