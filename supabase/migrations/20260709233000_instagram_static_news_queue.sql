CREATE TABLE instagram_static_news_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  curated_content_id UUID NOT NULL REFERENCES curated_content(id) ON DELETE CASCADE,
  source_platform TEXT NOT NULL,
  source_url TEXT,
  source_author TEXT,
  source_content TEXT NOT NULL,
  source_metrics JSONB DEFAULT '{}',
  launch_category TEXT NOT NULL,
  launch_score INTEGER NOT NULL DEFAULT 0,
  launch_reasons TEXT[] DEFAULT '{}',
  media_mode TEXT NOT NULL CHECK (media_mode IN ('curated_image', 'generated_image')),
  image_urls TEXT[] DEFAULT '{}',
  primary_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'promoted', 'rejected')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(curated_content_id)
);

CREATE INDEX idx_static_news_workspace_status
  ON instagram_static_news_queue(workspace_id, status, created_at DESC);

CREATE INDEX idx_static_news_launch_category
  ON instagram_static_news_queue(workspace_id, launch_category, created_at DESC);
