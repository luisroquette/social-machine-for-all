CREATE TABLE editorial_calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  planned_date DATE NOT NULL,
  theme TEXT NOT NULL,
  content_type TEXT DEFAULT 'tweet' CHECK (content_type IN ('tweet', 'thread', 'article', 'video', 'carousel')),
  target_platform TEXT DEFAULT 'x' CHECK (target_platform IN ('x', 'linkedin', 'instagram', 'blog')),
  strategy_notes TEXT,
  status TEXT DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'published', 'skipped')),
  generated_content_id UUID REFERENCES generated_content(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_editorial_workspace_date ON editorial_calendar(workspace_id, planned_date);
CREATE INDEX idx_editorial_status ON editorial_calendar(status);
CREATE TABLE performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  insights TEXT[] DEFAULT '{}',
  recommendations TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_performance_workspace ON performance_snapshots(workspace_id, created_at DESC);;
