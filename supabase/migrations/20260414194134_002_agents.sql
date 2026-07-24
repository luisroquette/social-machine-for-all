CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  system_prompt TEXT,
  config JSONB DEFAULT '{}',
  model TEXT DEFAULT 'deepseek-chat',
  telegram_bot_token TEXT,
  telegram_bot_username TEXT,
  schedule_cron TEXT,
  schedule_enabled BOOLEAN DEFAULT true,
  max_actions_per_hour INTEGER DEFAULT 30,
  quiet_hours_start INTEGER DEFAULT 0,
  quiet_hours_end INTEGER DEFAULT 6,
  active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  total_runs INTEGER DEFAULT 0,
  avg_score NUMERIC(4,2),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, slug)
);

CREATE INDEX idx_agents_workspace ON agents(workspace_id);
CREATE INDEX idx_agents_active ON agents(workspace_id, active);
CREATE INDEX idx_agents_schedule ON agents(schedule_enabled, last_run_at);

CREATE TABLE agent_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pipeline_run_id UUID,
  pipeline_stage TEXT,
  action_type TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'success', 'error')),
  input_summary TEXT,
  output_summary TEXT,
  items_processed INTEGER DEFAULT 0,
  items_produced INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  cost_estimate NUMERIC(8,4) DEFAULT 0,
  duration_ms INTEGER,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_actions_agent ON agent_actions(agent_id, created_at DESC);
CREATE INDEX idx_agent_actions_workspace ON agent_actions(workspace_id, created_at DESC);
CREATE INDEX idx_agent_actions_pipeline ON agent_actions(pipeline_run_id);

CREATE TABLE pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'partial')),
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  stages_completed TEXT[] DEFAULT '{}',
  trigger TEXT DEFAULT 'cron' CHECK (trigger IN ('cron', 'manual', 'telegram')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pipeline_runs_workspace ON pipeline_runs(workspace_id, created_at DESC);

ALTER TABLE agent_actions ADD CONSTRAINT fk_agent_actions_pipeline FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE SET NULL;;
