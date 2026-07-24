import { getAdminClient } from '@/lib/supabase/admin'
import type { TablesInsert } from '@/lib/supabase/database.types'

export interface AgentMemory {
  id: string
  agentSlug: string
  category: 'insight' | 'pattern' | 'preference' | 'warning'
  content: string
  context: Record<string, unknown>
  shared: boolean
  relevanceScore: number
  createdAt: string
  updatedAt: string
}

/**
 * Load relevant memories for an agent.
 * Returns top 10 individual + top 5 shared, with relevance decay applied.
 * Prunes memories that have decayed below 2.0.
 */
export async function loadMemories(
  workspaceId: string,
  agentSlug: string
): Promise<{ individual: AgentMemory[]; shared: AgentMemory[] }> {
  const supabase = getAdminClient()

  // Load individual + shared in parallel
  const [{ data: individual }, { data: shared }] = await Promise.all([
    supabase
      .from('agent_memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('agent_slug', agentSlug)
      .eq('shared', false)
      .order('relevance_score', { ascending: false })
      .limit(20), // Fetch more, filter after decay
    supabase
      .from('agent_memories')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('shared', true)
      .order('relevance_score', { ascending: false })
      .limit(10),
  ])

  const now = Date.now()

  function applyDecay(memories: any[]): AgentMemory[] {
    return memories.map((m) => {
      const weeksSinceUpdate = (now - new Date(m.updated_at).getTime()) / (7 * 24 * 60 * 60 * 1000)
      const decayedScore = Math.max(0, Number(m.relevance_score) - weeksSinceUpdate * 0.5)
      return {
        id: m.id,
        agentSlug: m.agent_slug,
        category: m.category,
        content: m.content,
        context: m.context ?? {},
        shared: m.shared,
        relevanceScore: Math.round(decayedScore * 100) / 100,
        createdAt: m.created_at,
        updatedAt: m.updated_at,
      }
    })
  }

  const decayedIndividual = applyDecay(individual ?? [])
  const decayedShared = applyDecay(shared ?? [])

  // Prune memories below 2.0
  const toPrune = [...decayedIndividual, ...decayedShared]
    .filter((m) => m.relevanceScore < 2.0)
    .map((m) => m.id)

  if (toPrune.length > 0) {
    await supabase.from('agent_memories').delete().in('id', toPrune)
  }

  return {
    individual: decayedIndividual.filter((m) => m.relevanceScore >= 2.0).slice(0, 10),
    shared: decayedShared.filter((m) => m.relevanceScore >= 2.0).slice(0, 5),
  }
}

/**
 * Save extracted memories to the database.
 * Deduplicates by content similarity (exact match for now).
 */
export async function saveMemories(
  workspaceId: string,
  agentSlug: string,
  memories: Array<{
    category: 'insight' | 'pattern' | 'preference' | 'warning'
    content: string
    context?: Record<string, unknown>
    shared?: boolean
  }>
): Promise<number> {
  if (memories.length === 0) return 0
  const supabase = getAdminClient()

  // Load existing memories for dedup
  const { data: existing } = await supabase
    .from('agent_memories')
    .select('content')
    .eq('workspace_id', workspaceId)
    .eq('agent_slug', agentSlug)

  const existingContents = new Set((existing ?? []).map((e: any) => e.content.toLowerCase().trim()))

  const newMemories = memories
    .filter((m) => !existingContents.has(m.content.toLowerCase().trim()))
    .map((m) => ({
      workspace_id: workspaceId,
      agent_slug: agentSlug,
      category: m.category,
      content: m.content,
      context: m.context ?? {},
      shared: m.shared ?? false,
      relevance_score: 8.0,
    }))

  if (newMemories.length === 0) return 0

  const { error } = await supabase.from('agent_memories').insert(newMemories as TablesInsert<'agent_memories'>[])
  if (error) {
    console.error(`[memory] Failed to save memories for ${agentSlug}:`, error.message)
    return 0
  }

  return newMemories.length
}

/**
 * Format memories as markdown for injection into agent prompts.
 */
export function formatMemoryContext(memories: { individual: AgentMemory[]; shared: AgentMemory[] }): string {
  const { individual, shared } = memories
  if (individual.length === 0 && shared.length === 0) return ''

  const lines: string[] = ['# Memoria Operacional']

  if (individual.length > 0) {
    lines.push('', '## Suas Memorias:')
    for (const m of individual) {
      const icon = m.category === 'warning' ? '⚠️' : m.category === 'insight' ? '💡' : m.category === 'pattern' ? '🔄' : '✅'
      lines.push(`- ${icon} [${m.category}] ${m.content}`)
    }
  }

  if (shared.length > 0) {
    lines.push('', '## Quadro Compartilhado (todos os agentes):')
    for (const m of shared) {
      const icon = m.category === 'warning' ? '⚠️' : m.category === 'insight' ? '💡' : m.category === 'pattern' ? '🔄' : '✅'
      lines.push(`- ${icon} [${m.category}] (${m.agentSlug}) ${m.content}`)
    }
  }

  return lines.join('\n')
}
