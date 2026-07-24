-- Workspace-owned library of grounded facts for evergreen content.
CREATE TABLE brand_pillar_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  pillar TEXT NOT NULL,
  fact TEXT NOT NULL,
  source TEXT,
  used_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_pillar_facts_workspace_pillar
  ON brand_pillar_facts(workspace_id, pillar, used_count);
