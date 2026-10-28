# Lazy Day

Events near you, nothing else. Expo (React Native + TypeScript) app, Supabase backend.
Accuracy is the point: events without a confirmed date, with conflicting dates, that the source page doesn't back up, or that are duplicates never reach the app.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env` and fill it in.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` are read by the app (via `app.config.ts`).
   - `ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are server-only and never enter the app bundle. The app reads only from Supabase and never calls Claude.
3. Create a Supabase project, then:
   ```sh
   supabase link --project-ref <ref>
   supabase db push                                   # runs supabase/migrations/*
   supabase secrets set ANTHROPIC_API_KEY=<key>
   supabase functions deploy fetch-events
   ```
4. Schedule it: edit `supabase/schedule.sql` (project ref + service role key) and run it in the SQL editor. It calls the function every 6 hours. Run it once by hand first:
   `curl -X POST https://<ref>.supabase.co/functions/v1/fetch-events -H "Authorization: Bearer <service role key>" -d '{"force":true}'`
5. `bunx expo start`, then open in Expo Go (iOS or Android).

Regions to keep fresh default to Detroit at 50 mi. Override with the function secret `FETCH_REGIONS='[{"lat":42.33,"lng":-83.04,"radiusMiles":50,"label":"Detroit, MI","timezone":"America/Detroit"}]'`. `label` and `timezone` steer the search prompt and date handling (timezone defaults to America/New_York).

## Commands

| | |
|---|---|
| `bun test` | unit tests: normalization, de-dupe, accuracy rules, ai-search JSON validation and drop rules (recorded-shape fixtures), iCal, robots.txt, app filters |
| `bun run typecheck` | `tsc --noEmit` |
| `bun scripts/run-fetcher.ts [lat lng miles]` | dry run of the whole pipeline, no DB writes. Defaults to Detroit, 15 mi. Prints kept vs dropped with a reason per event, and the run's cost. **Spends real money** |

## Sources

1. **`ai-search`** (default). Calls the Anthropic Messages API with `claude-sonnet-5-5` and the server-side `web_search_20260318` and `web_fetch_20260318` tools (current versions per the Anthropic docs). It searches several angles (city calendars, libraries, parks, venues, local news roundups), fetches the event pages, and returns strict JSON. Everything below is enforced in code after the model answers, not only in the prompt:
   - `source_url` must be a page Claude **fetched** (a successful `web_fetch_tool_result`). URLs seen only in search snippets, or whose fetch errored, are dropped (`not_fetched`).
   - The start date must appear on that page: `date_evidence` must be verbatim page text, and both it and the page must state the date (`date_not_on_page`). PDFs can't be checked and are dropped.
   - Time, price, age limit and "free" are kept only if the page states them; otherwise they stay unknown (date-only card, "Price: see details"). The model's guess is discarded.
   - Recurring listings with no specific date are dropped (`recurring_no_date`); invalid JSON items are dropped (`invalid_ai_output`).
   - Venue coordinates come from the US Census geocoder on the street address; events that can't be located are dropped (`no_location`).
   - The shared rules then apply: 14-day window, conflicting dates, radius, de-dupe.
   - Every dropped event is logged with a reason (console, and `ai_search_runs.dropped_log`).
2. **Local-calendar adapters** (`supabase/functions/_shared/adapters/`): official iCal/RSS/JSON feeds. One working example (City of Livonia iCal). They only get a `get(url)` that checks robots.txt first.
3. **Ticketmaster** is kept but **disabled by default**. Enable with `ENABLE_TICKETMASTER=true` plus `TICKETMASTER_API_KEY`.

### Caching

Runs are keyed by a rounded location grid (0.1°, about 7 miles) plus radius: `ai:<lat>:<lng>:<radius>`, stored in `ai_search_runs`. A key that ran within 5.5 hours is skipped (`{"force":true}` overrides). The 6-hour cron refreshes it. A failed run isn't cached, so the next invocation retries.

### Cost

Each run costs model tokens (`claude-sonnet-5-5`: $2 / $10 per million in / out, cache reads $0.20) plus $10 per 1,000 web searches; web fetch has no extra charge. `scripts/run-fetcher.ts` prints the measured cost from `usage`. At one region every 6 hours that is 4 runs a day per region.

## Accuracy rules (`supabase/functions/_shared/rules.ts`)

- Dropped: no confirmed start, start outside the next 14 days, conflicting date fields, cancelled/postponed, recurring iCal events (not expanded), no `source_url`, outside radius, plus the ai-search reasons above.
- De-dupe on normalized title + venue + start date. The more complete duplicate wins; ties go to earlier-listed sources (official adapters before ai-search).
- Never filled in: missing time → `all_day = true`, card shows **See details**. Missing price → `null`, card shows "Price: see details".
- Ended events are deleted every run. With no `ends_at`, an all-day event ends after its day and a timed one 3 hours after it starts. Events an adapter or Ticketmaster stops listing are pruned after a clean fetch; ai-search events are not pruned this way (its output varies run to run), they leave when they end.

## Adding a local calendar

1. Find an official iCal/RSS/JSON feed. Never scrape a site whose robots.txt disallows it.
2. Copy `supabase/functions/_shared/adapters/livonia.ts`, set the feed, area center and `coverage`.
3. Register it in `adapters/index.ts`.

## Known limits

- Test fixtures for ai-search follow the documented response shapes; they are not yet recordings of real API responses.
- A full ai-search run can take minutes. Supabase Edge Functions have a wall-clock limit, so a large region may need splitting into several smaller regions in `FETCH_REGIONS`.
- No refusal fallback model is configured; a refused run is logged as a source error and retried next cycle.
- Day grouping in the app uses the phone's time zone.
