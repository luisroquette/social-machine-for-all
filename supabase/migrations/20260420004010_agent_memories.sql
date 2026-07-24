CREATE TABLE agent_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  agent_slug TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('insight', 'pattern', 'preference', 'warning')),
  content TEXT NOT NULL,
  context JSONB DEFAULT '{}',
  shared BOOLEAN DEFAULT false,
  relevance_score NUMERIC(4,2) DEFAULT 8.0,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agent_memories_lookup
  ON agent_memories (workspace_id, agent_slug, relevance_score DESC);

CREATE INDEX idx_agent_memories_shared
  ON agent_memories (workspace_id, shared, relevance_score DESC)
  WHERE shared = true;

ALTER TABLE agent_memories ENABLE ROW LEVEL SECURITY;;
