import { loadMemories, saveMemories, formatMemoryContext } from '@/lib/memory/agent-memory'
import { extractMemoriesFromResult } from '@/lib/memory/extract-memories'
import { getAdminClient } from '@/lib/supabase/admin'
import { buildBrandContext } from '@/lib/brand/build-brand-context'
import { buildFeedbackGuardrails } from '@/lib/eval/feedback-loop'
import { loadSettings } from '@/lib/settings/load-settings'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { registry } from './agent-registry'
import type { AgentSlug, RunContext, AgentResult } from './agent-types'

interface RunOptions {
  workspaceId: string
  agentSlug: AgentSlug
  pipelineRunId?: string
  dryRun?: boolean
}

export async function runAgent(options: RunOptions): Promise<AgentResult> {
  const { workspaceId, agentSlug, pipelineRunId, dryRun = false } = options
  const supabase = getAdminClient()

  // 1. Load agent from registry
  const agent = registry.get(agentSlug)
  if (!agent) {
    throw new Error(`Agent '${agentSlug}' not found in registry`)
  }

  // 2. Load agent config from database
  interface DbAgent {
    id: string
    workspace_id: string
    slug: string
    telegram_bot_token: string | null
    total_runs: number
    [key: string]: unknown
  }
  const { data: dbAgent } = await supabase
    .from('agents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('slug', agentSlug)
    .eq('active', true)
    .single() as { data: DbAgent | null }

  if (!dbAgent) {
    throw new Error(`Agent '${agentSlug}' not found or inactive in workspace '${workspaceId}'`)
  }

  // 3. Check operating hours — hard block, no bypass
  if (!agent.isWithinOperatingHours()) {
    return {
      success: true,
      itemsProcessed: 0,
      itemsProduced: 0,
      errors: [],
      tokensUsed: 0,
      costEstimate: 0,
      durationMs: 0,
      details: { skipped: 'quiet_hours' },
    }
  }

  // 3b. Check rate limit (Q5)
  const maxPerHour = (dbAgent.max_actions_per_hour as number) ?? agent.config.maxActionsPerHour
  const rateCheck = await checkRateLimit(dbAgent.id, maxPerHour)
  if (!rateCheck.allowed) {
    console.warn(`[runner] Rate limit exceeded for ${agentSlug}: ${rateCheck.remaining}/${maxPerHour} remaining`)
    return {
      success: true,
      itemsProcessed: 0,
      itemsProduced: 0,
      errors: [],
      tokensUsed: 0,
      costEstimate: 0,
      durationMs: 0,
      details: { skipped: 'rate_limit', remaining: rateCheck.remaining, maxPerHour },
    }
  }

  // 4. Build run context
  // If agent has no bot token, fall back to editor-in-chief's token for reporting
  let botToken = dbAgent.telegram_bot_token as string | undefined
  if (!botToken) {
    const { data: editorAgent } = await supabase
      .from('agents')
      .select('telegram_bot_token')
      .eq('workspace_id', workspaceId)
      .eq('slug', 'editor-in-chief')
      .single()
    botToken = (editorAgent?.telegram_bot_token as string) ?? undefined
  }

  // Build brand context, feedback guardrails, and load settings in parallel
  const [brandContext, feedbackContext, settings, memories] = await Promise.all([
    buildBrandContext(workspaceId).catch((err) => {
      console.error(`[runner] brandContext failed for ${agentSlug}:`, err instanceof Error ? err.message : err)
      return ''
    }),
    buildFeedbackGuardrails(workspaceId, agentSlug).catch((err) => {
      console.error(`[runner] feedbackGuardrails failed for ${agentSlug}:`, err instanceof Error ? err.message : err)
      return ''
    }),
    loadSettings(workspaceId).catch((err) => {
      console.error(`[runner] loadSettings failed for ${agentSlug}:`, err instanceof Error ? err.message : err)
      return {}
    }),
    loadMemories(workspaceId, agentSlug).catch((err) => {
      console.error(`[runner] loadMemories failed for ${agentSlug}:`, err instanceof Error ? err.message : err)
      return { individual: [], shared: [] }
    }),
  ])

  const ctx: RunContext = {
    workspaceId,
    agentId: dbAgent.id,
    pipelineRunId,
    brandContext,
    feedbackContext,
    memoryContext: formatMemoryContext(memories),
    telegramChatId: undefined,
    telegramBotToken: botToken,
    dryRun,
    dbConfig: {
      model: (dbAgent.model as string) ?? agent.config.defaultModel,
      temperature: (dbAgent.config as Record<string, unknown>)?.temperature as number | undefined,
      max_actions_per_hour: (dbAgent.max_actions_per_hour as number) ?? agent.config.maxActionsPerHour,
      quiet_hours_start: (dbAgent.quiet_hours_start as number) ?? agent.config.quietHours.start,
      quiet_hours_end: (dbAgent.quiet_hours_end as number) ?? agent.config.quietHours.end,
      system_prompt: (dbAgent.system_prompt as string) ?? undefined,
      config: (dbAgent.config as Record<string, unknown>) ?? {},
    },
    settings: settings as Record<string, number | string>,
  }

  // 5. Load workspace for telegram group
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('telegram_group_id')
    .eq('id', workspaceId)
    .single() as { data: { telegram_group_id: number | null } | null }

  if (workspace?.telegram_group_id) {
    ctx.telegramChatId = Number(workspace.telegram_group_id)
  }

  // 5b. Reset stale running actions for this agent (stuck from previous Vercel timeout)
  await supabase
    .from('agent_actions')
    .update({
      status: 'error',
      error_message: 'Auto-reset: preso em running por mais de 10min (timeout do Vercel)',
      output_summary: JSON.stringify({ reason: 'stale_lock_reset' }),
    })
    .eq('agent_id', dbAgent.id)
    .eq('status', 'running')
    .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())

  // 6. Create action log entry
  const { data: action } = await supabase
    .from('agent_actions')
    .insert({
      agent_id: dbAgent.id,
      workspace_id: workspaceId,
      pipeline_run_id: pipelineRunId ?? null,
      pipeline_stage: agent.config.pipelineStage?.toString() ?? null,
      action_type: `${agentSlug}_run`,
      status: 'running',
    })
    .select('id')
    .single() as { data: { id: string } | null }

  const startTime = Date.now()

  // 7. Execute
  let result: AgentResult
  try {
    result = await agent.execute(ctx)
  } catch (error) {
    result = {
      success: false,
      itemsProcessed: 0,
      itemsProduced: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      tokensUsed: 0,
      costEstimate: 0,
      durationMs: Date.now() - startTime,
      details: {},
    }
  }

  result.durationMs = Date.now() - startTime

  // 8. Update action log
  if (action) {
    await supabase
      .from('agent_actions')
      .update({
        status: result.success ? 'success' : 'error',
        output_summary: JSON.stringify(result.details).slice(0, 2000),
        items_processed: result.itemsProcessed,
        items_produced: result.itemsProduced,
        tokens_used: result.tokensUsed,
        cost_estimate: result.costEstimate,
        duration_ms: result.durationMs,
        error_message: result.errors.join('; ') || null,
      })
      .eq('id', action.id)
  }

  // 9. Update agent last_run_at
  await supabase
    .from('agents')
    .update({
      last_run_at: new Date().toISOString(),
      total_runs: (dbAgent.total_runs ?? 0) + 1,
    })
    .eq('id', dbAgent.id)

  // 10. Self-evaluate and store in eval_dataset
  if (result.success && result.itemsProduced > 0) {
    try {
      const evalEntry = await agent.evaluate(result, ctx)
      await supabase.from('eval_dataset').insert({
        workspace_id: workspaceId,
        agent_slug: agentSlug,
        action_id: action?.id ?? null,
        input_summary: evalEntry.inputSummary,
        output_summary: evalEntry.outputSummary,
        auto_score: evalEntry.autoScore,
        dimensions: evalEntry.dimensions,
        issues: evalEntry.issues,
        verdict: evalEntry.verdict,
      })
    } catch (err) {
      console.error(`[runner] Eval failed for ${agentSlug}:`, err)
    }
  }

  // 11. Extract and save memories
  if (result.success) {
    try {
      const extracted = await extractMemoriesFromResult(agentSlug, result)
      if (extracted.length > 0) {
        const saved = await saveMemories(workspaceId, agentSlug, extracted)
        if (saved > 0) console.log(`[runner] Saved ${saved} memories for ${agentSlug}`)
      }
    } catch (err) {
      console.error(`[runner] Memory extraction failed for ${agentSlug}:`, err)
    }
  }

  // 12. Send Telegram report
  // Only publisher and editor-in-chief send to the group.
  // Heartbeat and daily-report crons handle their own alerts independently.
  // ANY agent with a critical error (402, 401, credentials) also sends an alert.
  const TELEGRAM_REPORT_AGENTS: AgentSlug[] = ['publisher', 'editor-in-chief']
  if (ctx.telegramChatId && ctx.telegramBotToken) {
    try {
      // Critical error alert — fires for ANY agent (catches silent 402, expired credentials, etc.)
      const CRITICAL_KEYWORDS = ['402', '401', 'creditsdepleted', 'credits depleted', 'no_credentials', 'missing x api']
      const criticalErrors = result.errors.filter(e =>
        CRITICAL_KEYWORDS.some(kw => e.toLowerCase().includes(kw.toLowerCase()))
      )
      if (criticalErrors.length > 0) {
        await sendTelegramMessage(
          ctx.telegramBotToken,
          ctx.telegramChatId,
          `🚨 *ALERTA CRÍTICO — ${agentSlug}*\n\n${criticalErrors[0].slice(0, 400)}`
        ).catch(err => console.error(`[runner] Critical alert failed for ${agentSlug}:`, err))
      }

      // Regular report for scheduled reporters
      if (TELEGRAM_REPORT_AGENTS.includes(agentSlug)) {
        const report = agent.formatTelegramReport(result)
        // Only send if the report has content — empty string means "nothing to report"
        if (report.trim()) {
          await sendTelegramMessage(ctx.telegramBotToken, ctx.telegramChatId, report)
        }
      }
    } catch (err) {
      console.error(`[runner] Telegram report failed for ${agentSlug}:`, err)
    }
  }

  return result
}

async function sendTelegramMessage(token: string, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => 'unknown')
    console.error(`[runner] Telegram send failed (${res.status}): ${body}`)
  }
}
