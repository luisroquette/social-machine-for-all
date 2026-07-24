export type AgentSlug =
  | 'editor-in-chief'
  | 'monitor'
  | 'curator'
  | 'writer'
  | 'reviewer'
  | 'publisher'
  | 'engagement-own'
  | 'engagement-external'
  | 'seo-strategist'
  | 'ads-strategist'
  | 'social-strategist'

export type PipelineStage = 1 | 2 | 3 | 4 | 5 | 6

export type ActionStatus = 'running' | 'success' | 'error'
export type EvalVerdict = 'keep' | 'improve' | 'reject'
export type PipelineRunStatus = 'running' | 'completed' | 'failed' | 'partial'
export type PipelineTrigger = 'cron' | 'manual' | 'telegram'

export interface AgentConfig {
  slug: AgentSlug
  name: string
  role: string
  description: string
  defaultModel: string
  pipelineStage?: PipelineStage
  maxActionsPerHour: number
  quietHours: { start: number; end: number }
}

export interface AgentDbConfig {
  model: string
  temperature?: number
  max_actions_per_hour: number
  quiet_hours_start: number
  quiet_hours_end: number
  system_prompt?: string
  config: Record<string, unknown>
}

export interface RunContext {
  workspaceId: string
  agentId: string
  pipelineRunId?: string
  brandContext: string
  feedbackContext: string
  memoryContext: string
  telegramChatId?: number
  telegramBotToken?: string
  dryRun: boolean
  /** Agent config from database (overrides hardcoded defaults) */
  dbConfig?: AgentDbConfig
  /** Workspace settings from workspace_settings table */
  settings?: Record<string, number | string>
}

export interface AgentResult {
  success: boolean
  itemsProcessed: number
  itemsProduced: number
  errors: string[]
  tokensUsed: number
  costEstimate: number
  durationMs: number
  details: Record<string, unknown>
}

export interface EvalEntry {
  agentSlug: AgentSlug
  inputSummary: string
  outputSummary: string
  autoScore: number
  dimensions: Record<string, number>
  issues: string[]
  verdict: EvalVerdict
}
