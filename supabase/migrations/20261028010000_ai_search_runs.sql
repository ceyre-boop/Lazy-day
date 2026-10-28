-- One row per cached ai-search run, keyed by a rounded location grid + radius.
-- Server-only: RLS on with no policies, so the app's anon key cannot read it.
create table if not exists public.ai_search_runs (
  cache_key    text primary key,          -- "ai:<lat .1°>:<lng .1°>:<radius mi>"
  last_run_at  timestamptz not null,
  kept         integer not null,
  dropped      integer not null,
  cost_usd     numeric(10, 4) not null,
  usage        jsonb not null,
  dropped_log  jsonb not null             -- every dropped event with its reason
);

alter table public.ai_search_runs enable row level security;
