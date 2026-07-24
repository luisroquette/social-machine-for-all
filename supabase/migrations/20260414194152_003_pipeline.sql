CREATE TABLE trending_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  relevance TEXT DEFAULT 'media' CHECK (relevance IN ('alta', 'media', 'baixa')),
  source TEXT,
  category TEXT,
  hashtags TEXT[] DEFAULT '{}',
  volume INTEGER DEFAULT 0,
  detected_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'curating', 'curated', 'stale')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trending_workspace_status ON trending_topics(workspace_id, status);
CREATE INDEX idx_trending_detected ON trending_topics(detected_at DESC);

CREATE TABLE curated_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  topic_id UUID REFERENCES trending_topics(id) ON DELETE SET NULL,
  source_platform TEXT NOT NULL,
  source_url TEXT,
  source_author TEXT,
  source_content TEXT NOT NULL,
  source_metrics JSONB DEFAULT '{}',
  relevance_score INTEGER DEFAULT 0,
  score_breakdown JSONB DEFAULT '{}',
  keyword_fingerprint TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'curated' CHECK (status IN ('curated', 'writing', 'written', 'reviewed', 'published', 'rejected')),
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_curated_workspace_status ON curated_content(workspace_id, status);
CREATE INDEX idx_curated_topic ON curated_content(topic_id);

CREATE TABLE generated_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  curated_content_id UUID REFERENCES curated_content(id) ON DELETE SET NULL,
  target_platform TEXT NOT NULL,
  target_format TEXT NOT NULL,
  content TEXT NOT NULL,
  model_used TEXT,
  review_score NUMERIC(4,2),
  review_feedback TEXT,
  review_issues TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'approved', 'rejected', 'published')),
  published_id TEXT,
  published_url TEXT,
  published_at TIMESTAMPTZ,
  pipeline_run_id UUID REFERENCES pipeline_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_generated_workspace_status ON generated_content(workspace_id, status);
CREATE INDEX idx_generated_curated ON generated_content(curated_content_id);;
