CREATE TABLE brand_marketing_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  pillar TEXT NOT NULL CHECK (pillar IN ('dor','modelo','execucao','midia','fomo','diptych','generico')),
  caption TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_brand_marketing_assets_workspace_unused ON brand_marketing_assets(workspace_id, used_at);;
