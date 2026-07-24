CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  topic_keywords TEXT[] DEFAULT '{}',
  brand_config JSONB DEFAULT '{}',
  platform_credentials JSONB DEFAULT '{}',
  telegram_group_id BIGINT,
  active BOOLEAN DEFAULT true,
  owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_workspaces_owner ON workspaces(owner_id);
CREATE INDEX idx_workspaces_active ON workspaces(active);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own workspaces" ON workspaces FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Users can manage own workspaces" ON workspaces FOR ALL USING (auth.uid() = owner_id);;
