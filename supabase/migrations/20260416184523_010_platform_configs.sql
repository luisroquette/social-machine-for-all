CREATE TABLE platform_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram')),
  max_length INTEGER NOT NULL,
  allow_hashtags BOOLEAN DEFAULT false,
  max_hashtags INTEGER DEFAULT 0,
  allow_emojis BOOLEAN DEFAULT false,
  require_image BOOLEAN DEFAULT false,
  tone TEXT,
  style_guide TEXT,
  engagement_style TEXT,
  hashtag_strategy TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, platform)
);
CREATE INDEX idx_platform_configs_workspace ON platform_configs(workspace_id, active);;
