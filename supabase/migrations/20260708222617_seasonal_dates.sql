-- Workspace-owned editorial dates. Content is added by each operator.
CREATE TABLE brand_seasonal_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  month INT CHECK (month BETWEEN 1 AND 12),
  day INT CHECK (day BETWEEN 1 AND 31),
  easter_offset_days INT,
  angle TEXT NOT NULL,
  is_priority BOOLEAN NOT NULL DEFAULT false,
  restriction_notes TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_used_year INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  CONSTRAINT brand_seasonal_dates_fixed_xor_movable CHECK (
    (month IS NOT NULL AND day IS NOT NULL AND easter_offset_days IS NULL)
    OR (month IS NULL AND day IS NULL AND easter_offset_days IS NOT NULL)
  )
);

CREATE INDEX idx_brand_seasonal_dates_workspace_enabled
  ON brand_seasonal_dates(workspace_id, enabled);
