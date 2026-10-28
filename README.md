# Lazy Day

Events near you, nothing else. Expo (React Native + TypeScript) app, Supabase backend.
Accuracy is the point: events without a confirmed date, with conflicting dates, or that are duplicates never reach the app.

## Setup

1. `bun install`
2. Copy `.env.example` to `.env` and fill it in.
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` are read by the app (via `app.config.ts`).
   - `TICKETMASTER_API_KEY` (free at developer.ticketmaster.com) and `SUPABASE_SERVICE_ROLE_KEY` are server-only and never enter the app bundle.
3. Create a Supabase project, then:
   ```sh
   supabase link --project-ref <ref>
   supabase db push                                   # runs supabase/migrations/*
   supabase secrets set TICKETMASTER_API_KEY=<key>
   supabase functions deploy fetch-events
   ```
4. Schedule it: edit `supabase/schedule.sql` (project ref + service role key) and run it in the SQL editor. It calls the function every 6 hours. Run it once by hand first:
   `curl -X POST https://<ref>.supabase.co/functions/v1/fetch-events -H "Authorization: Bearer <service role key>"`
5. `bunx expo start`, then open in Expo Go (iOS or Android).

Regions to keep fresh default to Detroit at 50 mi. Override with the function secret `FETCH_REGIONS='[{"lat":42.33,"lng":-83.04,"radiusMiles":50}]'`.

## Commands

| | |
|---|---|
| `bun test` | unit tests (normalization, de-dupe, accuracy rules, Ticketmaster + iCal mapping, robots.txt, app filters) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun scripts/run-fetcher.ts [lat lng miles]` | dry run of the whole pipeline, no DB writes. Defaults to Detroit, 15 mi. Prints kept vs dropped with a reason per event |

## Accuracy rules (`supabase/functions/_shared/rules.ts`)

- Dropped: no confirmed start, start outside the next 14 days, conflicting date fields (e.g. `localDate` vs `dateTime` in the venue's zone, or end before start), cancelled/postponed, recurring iCal events (not expanded yet), no `source_url`, outside radius.
- De-dupe on normalized title + venue + start date. The more complete duplicate wins; ties go to Ticketmaster.
- Never filled in: a Ticketmaster event with a date but no time is kept as `all_day = true` and the card shows **See details**. A missing price is `null` and the card shows "Price: see details". `is_free` is true only when the source says the price range is 0.
- `21+` and age notes come only from the listing's own text. Kids / Seasonal tags are keyword and classification based.
- Ended events are deleted every run (`delete_ended_events`). With no `ends_at`, an all-day event ends after its day and a timed one 3 hours after it starts. Events a source stops listing (cancelled or changed) are pruned after a clean fetch.

## Adding a local calendar

1. Find an official iCal/RSS/JSON feed. Never scrape a site whose robots.txt disallows it. Adapters only get a `get(url)` that checks robots.txt before every request and throws if disallowed.
2. Copy `supabase/functions/_shared/adapters/livonia.ts` (the working example, City of Livonia's iCal feed), set the feed, area center and `coverage`.
3. Register it in `adapters/index.ts`.

## Known limits

- Ticketmaster only needs a key; the Livonia example feed currently lists few events inside any 14-day window, so don't expect it to show much on its own.
- iCal feeds without coordinates use the adapter's `areaCenter` for the radius filter only.
- Day grouping uses the phone's time zone.
