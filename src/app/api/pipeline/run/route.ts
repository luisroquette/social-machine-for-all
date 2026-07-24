export const maxDuration = 300

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { getAdminClient } from '@/lib/supabase/admin'
import { registry } from '@/lib/agents/agent-registry'
import { runAgent } from '@/lib/agents/agent-runner'
import type { AgentSlug } from '@/lib/agents/agent-types'

/**
 * Full pipeline execution — runs all pipeline stages sequentially.
 * Triggered manually via API or Telegram command.
 */
export async function POST(request: Request) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { workspaceId, trigger = 'manual' } = body

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  await registry.loadAll()

  const supabase = getAdminClient()

  // Create pipeline run record
  const { data: pipelineRun } = await supabase
    .from('pipeline_runs')
    .insert({
      workspace_id: workspaceId,
      status: 'running',
      trigger,
    })
    .select('id')
    .single() as { data: { id: string } | null }

  if (!pipelineRun) {
    return NextResponse.json({ error: 'Failed to create pipeline run' }, { status: 500 })
  }

  const pipelineId = pipelineRun.id
  const pipelineAgents = registry.getPipelineOrder()
  const stagesCompleted: string[] = []
  const results: Record<string, unknown> = {}

  for (const agent of pipelineAgents) {
    const slug = agent.config.slug

    try {
      const result = await runAgent({
        workspaceId,
        agentSlug: slug,
        pipelineRunId: pipelineId,
      })

      results[slug] = {
        success: result.success,
        itemsProcessed: result.itemsProcessed,
        itemsProduced: result.itemsProduced,
      }

      if (result.success) {
        stagesCompleted.push(slug)
      } else {
        // Pipeline continues even if a stage fails (partial completion)
        console.warn(`[pipeline] Stage ${slug} failed, continuing...`)
      }
    } catch (error) {
      console.error(`[pipeline] Stage ${slug} error:`, error)
      results[slug] = { success: false, error: String(error) }
    }

    // Update pipeline progress
    await supabase
      .from('pipeline_runs')
      .update({ stages_completed: stagesCompleted })
      .eq('id', pipelineId)
  }

  // Mark pipeline as completed
  const finalStatus = stagesCompleted.length === pipelineAgents.length
    ? 'completed'
    : stagesCompleted.length > 0
      ? 'partial'
      : 'failed'

  await supabase
    .from('pipeline_runs')
    .update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      stages_completed: stagesCompleted,
    })
    .eq('id', pipelineId)

  return NextResponse.json({
    ok: true,
    pipelineRunId: pipelineId,
    status: finalStatus,
    stagesCompleted,
    results,
  })
}
