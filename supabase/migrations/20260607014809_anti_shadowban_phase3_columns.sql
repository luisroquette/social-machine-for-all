
ALTER TABLE generated_content
  ADD COLUMN IF NOT EXISTS reach INTEGER,
  ADD COLUMN IF NOT EXISTS engagement_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS story_delay_minutes INTEGER;
;
