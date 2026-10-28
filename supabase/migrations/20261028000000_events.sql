create table if not exists public.events (
  id            text primary key,              -- "<source_name>:<source id>"
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  all_day       boolean not null default false, -- date known, time of day not
  venue         text,
  address       text,
  city          text,
  lat           double precision,
  lng           double precision,
  price_text    text,                           -- null = unknown ("See details")
  is_free       boolean not null default false,
  categories    text[] not null default '{}',
  age_note      text,
  source_name   text not null,
  source_url    text not null,
  fetched_at    timestamptz not null
);

create index if not exists events_starts_at_idx on public.events (starts_at);

alter table public.events enable row level security;

-- The app reads with the anon key; only the service role (Edge Function) writes.
create policy "events are readable by everyone" on public.events for select using (true);

create or replace function public.miles_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 3958.8 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Events within radius_mi miles that have not ended yet, soonest first.
create or replace function public.events_near(user_lat double precision, user_lng double precision, radius_mi double precision)
returns setof public.events language sql stable as $$
  select * from public.events
  where lat is not null and lng is not null
    and public.miles_between(user_lat, user_lng, lat, lng) <= radius_mi
    and coalesce(ends_at, case when all_day then starts_at + interval '1 day' else starts_at + interval '3 hours' end) > now()
  order by starts_at;
$$;

-- "Delete events after they end." No ends_at: all-day events end after their day, timed ones 3 h after start.
create or replace function public.delete_ended_events() returns integer language plpgsql security definer as $$
declare n integer;
begin
  delete from public.events
  where coalesce(ends_at, case when all_day then starts_at + interval '1 day' else starts_at + interval '3 hours' end) < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Cancellations/changes: after a clean fetch, remove rows from those sources in the region that the
-- source no longer lists (not re-fetched this run) and that start inside the fetched window.
create or replace function public.prune_unseen_events(
  sources text[], center_lat double precision, center_lng double precision, radius_mi double precision,
  run_started timestamptz, window_end timestamptz
) returns integer language plpgsql security definer as $$
declare n integer;
begin
  delete from public.events
  where source_name = any(sources)
    and fetched_at < run_started
    and starts_at >= now() and starts_at < window_end
    and lat is not null and lng is not null
    and public.miles_between(center_lat, center_lng, lat, lng) <= radius_mi;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.delete_ended_events() from public, anon, authenticated;
revoke all on function public.prune_unseen_events(text[], double precision, double precision, double precision, timestamptz, timestamptz) from public, anon, authenticated;
