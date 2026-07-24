CREATE TABLE workspace_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, category, key)
);

CREATE INDEX idx_workspace_settings_lookup ON workspace_settings(workspace_id, category);

-- Defaults are created by onboarding after a workspace exists.
-- A schema migration must not embed a workspace ID, account handle or brand data.
