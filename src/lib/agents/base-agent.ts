import type { AgentConfig, AgentResult, RunContext, EvalEntry } from './agent-types'
import type { ExtractedMemory } from '@/lib/memory/extract-memories'

export abstract class BaseAgent {
  /** Agent configuration — slug, name, model, pipeline stage, etc. */
  abstract get config(): AgentConfig

  /** Core execution — every agent implements this */
  abstract execute(ctx: RunContext): Promise<AgentResult>

  /** Self-evaluation — returns quality score for the eval dataset */
  abstract evaluate(result: AgentResult, ctx: RunContext): Promise<EvalEntry>

  /** Format a Telegram report message after execution */
  formatTelegramReport(result: AgentResult): string {
    const status = result.success ? '✅' : '❌'
    const lines = [
      `${status} *${this.config.name}*`,
      `Processados: ${result.itemsProcessed} | Produzidos: ${result.itemsProduced}`,
      `Tokens: ${result.tokensUsed} | Custo: $${result.costEstimate.toFixed(4)}`,
      `Tempo: ${(result.durationMs / 1000).toFixed(1)}s`,
    ]
    if (result.errors.length > 0) {
      lines.push(`Erros: ${result.errors.join(', ')}`)
    }
    return lines.join('\n')
  }

  /** Extract operational memories from execution results. Override in subclasses for custom extraction. */
  async extractMemories(_result: AgentResult, _ctx: RunContext): Promise<ExtractedMemory[]> {
    return []
  }

  /** Check if the agent is within operating hours */
  isWithinOperatingHours(timezone: string = 'America/Sao_Paulo'): boolean {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: timezone,
    })
    const currentHour = parseInt(formatter.format(now), 10)
    const { start, end } = this.config.quietHours

    // If quiet hours span midnight (e.g., 22-6), check if we're NOT in quiet hours
    if (start > end) {
      return currentHour >= end && currentHour < start
    }
    // If quiet hours don't span midnight (e.g., 0-6)
    return currentHour < start || currentHour >= end
  }
}
