-- Snapshot diário de métricas de perfil (followers_count funciona com o token EAA;
-- per-reel insights exigem o scope instagram_manage_insights ainda não concedido).
-- Permite medir crescimento de seguidores ao longo do tempo (conversão view->follow).
create table if not exists public.profile_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  snapshot_date date not null,
  followers_count integer,
  media_count integer,
  created_at timestamptz not null default now(),
  unique (workspace_id, snapshot_date)
);

create index if not exists idx_profile_snapshots_ws_date
  on public.profile_metrics_snapshots (workspace_id, snapshot_date desc);;
