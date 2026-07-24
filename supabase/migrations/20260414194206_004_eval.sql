CREATE TABLE eval_dataset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  action_id UUID REFERENCES agent_actions(id) ON DELETE SET NULL,
  input_summary TEXT,
  output_summary TEXT,
  auto_score NUMERIC(4,2),
  human_score NUMERIC(4,2),
  feedback TEXT,
  issues TEXT[] DEFAULT '{}',
  dimensions JSONB DEFAULT '{}',
  verdict TEXT CHECK (verdict IN ('keep', 'improve', 'reject')),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_eval_agent ON eval_dataset(agent_slug, created_at DESC);
CREATE INDEX idx_eval_workspace ON eval_dataset(workspace_id, created_at DESC);
CREATE INDEX idx_eval_verdict ON eval_dataset(verdict);;
