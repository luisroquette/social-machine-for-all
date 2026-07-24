CREATE TABLE ad_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('meta', 'x', 'google')),
  external_campaign_id TEXT,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  daily_budget NUMERIC(10,2),
  total_spent NUMERIC(10,2) DEFAULT 0,
  performance JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ad_campaigns_workspace ON ad_campaigns(workspace_id, status);
CREATE INDEX idx_ad_campaigns_platform ON ad_campaigns(platform);
CREATE TABLE ad_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  spend NUMERIC(10,2) DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  ctr NUMERIC(6,4),
  cpc NUMERIC(8,4),
  cpa NUMERIC(8,4),
  roas NUMERIC(8,4),
  metadata JSONB DEFAULT '{}',
  UNIQUE(campaign_id, date)
);
CREATE INDEX idx_ad_performance_campaign ON ad_performance(campaign_id, date DESC);;
