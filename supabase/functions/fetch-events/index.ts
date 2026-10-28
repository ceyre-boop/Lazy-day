import { createClient } from 'npm:@supabase/supabase-js@2'
import { runRegion, WINDOW_DAYS } from '../_shared/run.ts'
import { createAnthropicRunner } from '../_shared/ai-search/client.ts'
import { AI_SEARCH } from '../_shared/ai-search/adapter.ts'
import type { Region } from '../_shared/types.ts'

// Regions to keep fresh. Override with FETCH_REGIONS='[{"lat":..,"lng":..,"radiusMiles":..,"label":"..","timezone":".."}]'.
// radiusMiles should be the largest the app offers (50) so every radius setting has data.
const DEFAULT_REGIONS: Region[] = [
  { lat: 42.3314, lng: -83.0458, radiusMiles: 50, label: 'Detroit, MI', timezone: 'America/Detroit' },
]

// A run is reused if the same grid cell + radius ran less than this long ago. A bit under the 6 h cron
// period so scheduler jitter never causes a skipped refresh.
const CACHE_TTL_MS = 5.5 * 3_600_000

/** Cache key: location rounded to a 0.1° grid (about 7 miles) plus radius. */
export const cacheKey = (r: Region) => `ai:${r.lat.toFixed(1)}:${r.lng.toFixed(1)}:${r.radiusMiles}`

Deno.serve(async (req) => {
  const env = (k: string) => Deno.env.get(k)
  const supabase = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({}))
  const regions: Region[] = body.regions ?? JSON.parse(env('FETCH_REGIONS') ?? 'null') ?? DEFAULT_REGIONS
  const anthropicKey = env('ANTHROPIC_API_KEY')

  const report = []
  for (const region of regions) {
    const key = cacheKey(region)
    if (!body.force) {
      const { data: prior } = await supabase.from('ai_search_runs').select('last_run_at').eq('cache_key', key).maybeSingle()
      if (prior && Date.now() - Date.parse(prior.last_run_at) < CACHE_TTL_MS) {
        report.push({ region, cacheKey: key, skipped: 'cached', lastRunAt: prior.last_run_at })
        continue
      }
    }

    const runStarted = new Date()
    const r = await runRegion(region, {
      aiRunner: anthropicKey ? createAnthropicRunner(anthropicKey) : undefined,
      enableTicketmaster: env('ENABLE_TICKETMASTER') === 'true',
      ticketmasterKey: env('TICKETMASTER_API_KEY'),
      now: runStarted,
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

    // Only a successful ai-search run is cached; a failed one is retried on the next invocation.
    if (r.aiSearch) {
      await supabase.from('ai_search_runs').upsert({
        cache_key: key,
        last_run_at: runStarted.toISOString(),
        kept: r.rows.length,
        dropped: r.dropped.length,
        cost_usd: r.aiSearch.costUsd.toFixed(4),
        usage: r.aiSearch.usage,
        dropped_log: dropLog,
      })
    }

    report.push({
      region,
      cacheKey: key,
      fetched: r.fetchedCount,
      kept: r.rows.length,
      dropped: r.dropped.length,
      upserted,
      pruned,
      costUsd: r.aiSearch?.costUsd ?? null,
      sourceErrors: r.sourceErrors,
    })
  }

  const { data: deleted } = await supabase.rpc('delete_ended_events')
  return Response.json({ ok: true, deletedEnded: deleted ?? 0, report })
})
