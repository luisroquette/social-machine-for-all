
ALTER TABLE curated_content
  ADD COLUMN IF NOT EXISTS skip_reason TEXT,
  ADD COLUMN IF NOT EXISTS skip_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_curated_content_skip_reason
  ON curated_content(skip_reason) WHERE skip_reason IS NOT NULL;
;
