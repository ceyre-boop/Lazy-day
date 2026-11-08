-- One row per paid ai-search run, so a rolling monthly spend ceiling can be enforced.
-- Server-only: RLS on with no policies, so the app's anon key cannot read it.
create table if not exists public.ai_spend_log (
  id         bigint generated always as identity primary key,
  ran_at     timestamptz not null default now(),
  region_key text not null,
  cost_usd   numeric(10, 4) not null
);
create index if not exists ai_spend_log_ran_at on public.ai_spend_log (ran_at);
alter table public.ai_spend_log enable row level security;
