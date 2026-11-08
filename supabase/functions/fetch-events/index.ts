import { createClient } from 'npm:@supabase/supabase-js@2'
import { runRegion, WINDOW_DAYS } from '../_shared/run.ts'
import { createAnthropicRunner } from '../_shared/ai-search/client.ts'
import { AI_SEARCH } from '../_shared/ai-search/adapter.ts'
import { sanitizeHints, type Hints } from '../_shared/ai-search/hints.ts'
import type { Region } from '../_shared/types.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

// Regions to keep fresh. Override with FETCH_REGIONS='[{"lat":..,"lng":..,"radiusMiles":..,"label":"..","timezone":".."}]'.
// radiusMiles should be the largest the app offers (50) so every radius setting has data.
const DEFAULT_REGIONS: Region[] = [
  { lat: 42.3314, lng: -83.0458, radiusMiles: 50, label: 'Detroit, MI', timezone: 'America/Detroit' },
]

// A region is refreshed at most once per window, however many visitors open the app.
const CACHE_TTL_MS = 22 * 3_600_000

/** Cache key: location rounded to a 0.1° grid (about 7 miles) plus radius. */
export const cacheKey = (r: Region) => `ai:${r.lat.toFixed(1)}:${r.lng.toFixed(1)}:${r.radiusMiles}`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (v: unknown) => Response.json(v, { headers: CORS })

type Db = ReturnType<typeof createClient>
type Env = (k: string) => string | undefined

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const env: Env = (k) => Deno.env.get(k)
  const supabase = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)

  // The scheduler/admin (FETCH_SECRET or service role key) can force a run and choose regions. Anyone else
  // (the web app calling on page load) only triggers the configured regions, at most once per window, so
  // visitors can never run up the Anthropic bill.
  const auth = req.headers.get('Authorization')
  const isAdmin = auth === `Bearer ${env('FETCH_SECRET')}` || auth === `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`
  const rawBody = await req.json().catch(() => ({}))
  const body = isAdmin ? rawBody : {}
  const hints = sanitizeHints(rawBody?.hints)
  const force = body.force === true
  const regions: Region[] = body.regions ?? JSON.parse(env('FETCH_REGIONS') ?? 'null') ?? DEFAULT_REGIONS

  // Atomically claim each stale region so concurrent visitors don't start duplicate runs.
  const claimed: Region[] = []
  const skipped: unknown[] = []
  const cutoff = new Date(Date.now() - CACHE_TTL_MS).toISOString()
  const nowIso = new Date().toISOString()
  for (const region of regions) {
    const key = cacheKey(region)
    if (force) {
      claimed.push(region)
      continue
    }
    const upd = await supabase.from('ai_search_runs').update({ last_run_at: nowIso }).eq('cache_key', key).lt('last_run_at', cutoff).select('cache_key')
    let ok = (upd.data?.length ?? 0) > 0
    if (!ok) {
      const ins = await supabase
        .from('ai_search_runs')
        .upsert(
          { cache_key: key, last_run_at: nowIso, kept: 0, dropped: 0, cost_usd: '0', usage: {}, dropped_log: [] },
          { onConflict: 'cache_key', ignoreDuplicates: true },
        )
        .select('cache_key')
      ok = (ins.data?.length ?? 0) > 0
    }
    if (ok) claimed.push(region)
    else skipped.push({ region, cacheKey: key, skipped: 'fresh' })
  }

  const work = async () => {
    const report: unknown[] = [...skipped]
    for (const region of claimed) {
      const key = cacheKey(region)
      try {
        report.push(await refreshRegion(supabase, region, key, env, hints))
      } catch (e) {
        // Release the claim so the next visit retries.
        await supabase.from('ai_search_runs').update({ last_run_at: new Date(0).toISOString() }).eq('cache_key', key)
        report.push({ region, cacheKey: key, error: (e as Error).message })
        console.error(`refresh failed for ${key}: ${(e as Error).message}`)
      }
    }
    const { data: deleted } = await supabase.rpc('delete_ended_events')
    return { ok: true, deletedEnded: deleted ?? 0, report }
  }

  if (isAdmin) return reply(await work())
  if (claimed.length === 0) return reply({ status: 'fresh' })
  // Answer right away; the refresh keeps running in the background.
  const p = work()
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p)
  else await p
  return reply({ status: 'started' })
})

async function refreshRegion(supabase: Db, region: Region, key: string, env: Env, hints: Hints) {
  // Hard monthly ceiling on Anthropic spend: past it, only the free sources keep refreshing.
  const budget = Number(env('AI_MONTHLY_BUDGET_USD') ?? 10)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: spent } = await supabase.from('ai_spend_log').select('cost_usd').gte('ran_at', since)
  const spentUsd = (spent ?? []).reduce((n: number, r: { cost_usd: number | string }) => n + Number(r.cost_usd), 0)
  const anthropicKey = spentUsd >= budget ? undefined : env('ANTHROPIC_API_KEY')
  const runStarted = new Date()
  const r = await runRegion(region, {
    aiRunner: anthropicKey ? createAnthropicRunner(anthropicKey) : undefined,
    enableTicketmaster: env('ENABLE_TICKETMASTER') === 'true',
    ticketmasterKey: env('TICKETMASTER_API_KEY'),
    now: runStarted,
    aiHints: hints,
    aiMaxSearches: Number(env('AI_MAX_SEARCHES') ?? 8),
    aiMaxFetches: Number(env('AI_MAX_FETCHES') ?? 16),
  })

  let upserted = 0
  for (let i = 0; i < r.rows.length; i += 500) {
    const { error } = await supabase.from('events').upsert(r.rows.slice(i, i + 500), { onConflict: 'id' })
    if (error) throw new Error(`upsert failed: ${error.message}`)
    upserted += Math.min(500, r.rows.length - i)
  }

  // Prune events a source stopped listing, except ai-search: its output varies run to run, so absence
  // from one run is not evidence an event was cancelled. Its events leave when they end.
  const pruneSources = r.okSources.filter((s) => s !== AI_SEARCH)
  let pruned = 0
  if (pruneSources.length > 0) {
    const windowEnd = new Date(runStarted.getTime() + WINDOW_DAYS * 86_400_000)
    const { data } = await supabase.rpc('prune_unseen_events', {
      sources: pruneSources,
      center_lat: region.lat,
      center_lng: region.lng,
      radius_mi: region.radiusMiles,
      run_started: runStarted.toISOString(),
      window_end: windowEnd.toISOString(),
    })
    pruned = data ?? 0
  }

  const dropLog = r.dropped.map((d) => ({ source: d.sourceName, title: d.title, reason: d.reason, detail: d.detail, url: d.sourceId }))
  for (const d of dropLog) console.log(`dropped [${d.reason}] ${d.source} "${d.title}": ${d.detail}`)

  await supabase.from('ai_search_runs').upsert({
    cache_key: key,
    last_run_at: runStarted.toISOString(),
    kept: r.rows.length,
    dropped: r.dropped.length,
    cost_usd: (r.aiSearch?.costUsd ?? 0).toFixed(4),
    usage: r.aiSearch?.usage ?? {},
    dropped_log: dropLog,
  })

  if (r.aiSearch) await supabase.from('ai_spend_log').insert({ cost_usd: r.aiSearch.costUsd, region_key: key })

  return {
    region,
    cacheKey: key,
    fetched: r.fetchedCount,
    kept: r.rows.length,
    dropped: r.dropped.length,
    upserted,
    pruned,
    costUsd: r.aiSearch?.costUsd ?? null,
    sourceErrors: r.sourceErrors,
  }
}
