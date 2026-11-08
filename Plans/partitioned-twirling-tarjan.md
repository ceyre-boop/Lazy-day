# Plan: spend the Anthropic key only on days the app is opened, and aim each search at what you like

## Context
Claude web search costs about $0.75 per run. The goal is to run it as rarely as possible, and to spend each run on the things you and your girlfriend actually want, instead of a generic sweep. Taste is already learned on-device (`src/lib/taste.ts`: ♡ Save, ✕ Not for me, Details taps). Nothing yet feeds that into the search.

Already true, no change needed: there is no cron job (never scheduled). The backend refreshes only when someone opens the app, at most once per 22 h per region (`CACHE_TTL_MS`, atomic claim in `supabase/functions/fetch-events/index.ts`). Public callers cannot force a run or pick a region.

## Changes

1. **Send taste hints with the page-load refresh** (app)
   - `src/lib/taste.ts`: add `searchHints(taste)` returning `{ likes: string[], avoids: string[] }`. Likes are the top ~8 positive features (words, venues, categories, prefix stripped). Avoids are features at or below -0.5, top ~5. Empty until something is saved or hidden.
   - `src/lib/supabase.ts`: `triggerRefresh(hints)` posts `{ hints }`.
   - `src/EventsScreen.tsx`: pass `searchHints(taste)` once taste has loaded (the trigger effect currently fires before `loadTaste()` resolves; reorder so hints are not empty on first open).

2. **Accept and sanitize hints in the function** (`supabase/functions/fetch-events/index.ts`)
   - Non-admin callers may send only `hints`. Server keeps at most 8 likes and 5 avoids, each 40 characters or fewer, letters, digits, spaces and `&'.-` only. Everything else is dropped, so a stranger cannot inject prompt text or inflate the prompt.
   - Pass through `refreshRegion` → `runRegion` (`_shared/run.ts`, new `aiHints` dep) → `createAiSearchAdapter` → `buildPrompt` (`_shared/ai-search/adapter.ts`).
   - Hints are not part of the cache key, so personalization never causes an extra run.

3. **Make the prompt use them and cut waste** (`buildPrompt`)
   - Add: "Prioritise events matching: <likes>. De-prioritise or skip: <avoids>. Spend searches on where those events are listed (venue calendars, team and league schedules, specific libraries and parks)."
   - Tell the model to skip big ticketed concerts and pro sports (Ticketmaster already supplies them) and focus on free, kids, community, library, park, seasonal and local events. This is the main saving and fills the thin Kids and Free categories.
   - Lower defaults to 8 searches and 16 fetches (`AI_MAX_SEARCHES` and `AI_MAX_FETCHES` stay overridable).

4. **Hard spend guard** (`index.ts`)
   - Skip the AI step if the rolling 30-day sum of `ai_search_runs.cost_usd` exceeds `AI_MONTHLY_BUDGET_USD` (default 10). Needs a small `ai_spend_log` table (one row per run) because `ai_search_runs` keeps only the latest run per region. Ticketmaster and city feeds keep refreshing regardless.

5. **Open item from last run:** re-run once after the evidence-matching fix (about $0.75, needs your OK) to confirm AI events now pass the accuracy rules. `no_location` drops (Census geocoder misses) are still unfixed.

## Tests
- `src/lib/taste.test.ts`: `searchHints` returns liked terms, avoided terms, and nothing for an empty taste.
- `ai-search.test.ts`: `buildPrompt` includes hints; omits the section when none.
- New test for hint sanitizing (length, count, character set, injection-looking text).
- `bun run typecheck && bun test`.

## Verification
1. Deploy function (`supabase functions deploy fetch-events --no-verify-jwt`) and web (`vercel --prod`).
2. Public call with hints twice: first returns `started` (or `fresh` if already run today), second `fresh`. Confirm `ai_search_runs` has one row and cost is logged.
3. After one approved paid run: check kept vs dropped by reason, category counts (Kids, Free, Seasonal), and cost under about $0.50.

## Caveats to tell you
- Taste is per device. The hints sent are from whoever opens the app first each day, so the day's search follows that person's taste.
- Rotate the Anthropic key; it was pasted into the chat.
