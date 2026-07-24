create table if not exists public.instagram_comment_interactions (
  id bigserial primary key,
  comment_id text unique not null,
  workspace_id text not null,
  media_id text,
  parent_id text,
  from_id text not null,
  from_username text,
  text text,
  status text not null default 'pending',
  skip_reason text,
  ai_reply text,
  reply_comment_id text,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_ig_comment_interactions_status
  on public.instagram_comment_interactions(status);

create index if not exists idx_ig_comment_interactions_workspace
  on public.instagram_comment_interactions(workspace_id, status);

alter table public.instagram_comment_interactions enable row level security;;
