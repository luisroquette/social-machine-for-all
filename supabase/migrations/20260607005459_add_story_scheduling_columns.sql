ALTER TABLE generated_content
  ADD COLUMN IF NOT EXISTS story_publish_after timestamptz,
  ADD COLUMN IF NOT EXISTS story_cover_url text;;
