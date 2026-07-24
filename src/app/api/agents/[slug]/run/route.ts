export const maxDuration = 300

import { NextResponse } from 'next/server'
import { isCronRequest } from '@/lib/api/auth'
import { registry } from '@/lib/agents/agent-registry'
import { runAgent } from '@/lib/agents/agent-runner'
import type { AgentSlug } from '@/lib/agents/agent-types'

interface RouteParams {
  params: Promise<{ slug: string }>
}

/**
 * Unified agent execution endpoint.
 * Called by the scheduler cron or manually via API.
 */
export async function POST(request: Request, { params }: RouteParams) {
  if (!isCronRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { slug } = await params
  const body = await request.json()
  const { workspaceId, pipelineRunId, trigger, dryRun } = body

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
  }

  // Ensure registry is loaded
  await registry.loadAll()

  const agentSlug = slug as AgentSlug
  if (!registry.has(agentSlug)) {
    return NextResponse.json({ error: `Agent '${slug}' not found` }, { status: 404 })
  }

  try {
    const result = await runAgent({
      workspaceId,
      agentSlug,
      pipelineRunId,
      dryRun: dryRun ?? false,
    })

    return NextResponse.json({
      ok: result.success,
      agent: slug,
      trigger: trigger ?? 'api',
      result,
    })
  } catch (error) {
    console.error(`[agent-run] ${slug} failed:`, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
