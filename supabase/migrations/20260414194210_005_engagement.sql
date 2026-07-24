CREATE TABLE engagement_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  target_platform TEXT NOT NULL,
  target_url TEXT,
  target_author TEXT,
  action_type TEXT NOT NULL CHECK (action_type IN ('like', 'comment', 'like_and_comment')),
  comment_text TEXT,
  comment_style TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executed', 'failed')),
  executed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_engagement_workspace ON engagement_actions(workspace_id, created_at DESC);
CREATE INDEX idx_engagement_agent ON engagement_actions(agent_slug);

CREATE TABLE monitor_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT,
  feed_url TEXT,
  keywords TEXT[] DEFAULT '{}',
  exclude_keywords TEXT[] DEFAULT '{}',
  min_engagement INTEGER DEFAULT 5,
  active BOOLEAN DEFAULT true,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_monitor_sources_workspace ON monitor_sources(workspace_id, active);

CREATE TABLE engagement_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  last_engaged_at TIMESTAMPTZ,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_engagement_profiles_workspace ON engagement_profiles(workspace_id, active);;
