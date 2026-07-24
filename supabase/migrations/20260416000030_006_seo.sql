CREATE TABLE seo_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  audit_type TEXT DEFAULT 'full' CHECK (audit_type IN ('technical', 'content', 'full')),
  score NUMERIC(4,2),
  issues JSONB DEFAULT '[]',
  recommendations JSONB DEFAULT '[]',
  raw_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_seo_audits_workspace ON seo_audits(workspace_id, created_at DESC);
CREATE TABLE seo_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  search_volume INTEGER,
  difficulty NUMERIC(4,2),
  current_rank INTEGER,
  opportunity_score NUMERIC(4,2),
  status TEXT DEFAULT 'tracking' CHECK (status IN ('tracking', 'targeting', 'ranking', 'lost')),
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, keyword)
);
CREATE INDEX idx_seo_keywords_workspace ON seo_keywords(workspace_id, status);;
