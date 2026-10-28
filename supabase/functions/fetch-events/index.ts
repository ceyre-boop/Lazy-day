import { createClient } from 'npm:@supabase/supabase-js@2'
import { runRegion, WINDOW_DAYS } from '../_shared/run.ts'
import type { Region } from '../_shared/types.ts'

// Regions to keep fresh. Override with FETCH_REGIONS='[{"lat":..,"lng":..,"radiusMiles":..}]'.
// radiusMiles should be the largest the app offers (50) so every radius setting has data.
const DEFAULT_REGIONS: Region[] = [{ lat: 42.3314, lng: -83.0458, radiusMiles: 50 }]

Deno.serve(async (req) => {
  const env = (k: string) => Deno.env.get(k)
  const supabase = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({}))
  const regions: Region[] = body.regions ?? JSON.parse(env('FETCH_REGIONS') ?? 'null') ?? DEFAULT_REGIONS

  const report = []
  for (const region of regions) {
    const runStarted = new Date()
    const r = await runRegion(region, { ticketmasterKey: env('TICKETMASTER_API_KEY'), now: runStarted })

    let upserted = 0
    for (let i = 0; i < r.rows.length; i += 500) {
      const { error } = await supabase.from('events').upsert(r.rows.slice(i, i + 500), { onConflict: 'id' })
      if (error) throw new Error(`upsert failed: ${error.message}`)
      upserted += Math.min(500, r.rows.length - i)
    }

    let pruned = 0
    if (r.okSources.length > 0) {
      const windowEnd = new Date(runStarted.getTime() + WINDOW_DAYS * 86_400_000)
      const { data } = await supabase.rpc('prune_unseen_events', {
        sources: r.okSources,
        center_lat: region.lat,
        center_lng: region.lng,
        radius_mi: region.radiusMiles,
        run_started: runStarted.toISOString(),
        window_end: windowEnd.toISOString(),
      })
      pruned = data ?? 0
    }

    report.push({
      region,
      fetched: r.fetchedCount,
      kept: r.rows.length,
      dropped: r.dropped.length,
      upserted,
      pruned,
      sourceErrors: r.sourceErrors,
    })
  }

  const { data: deleted } = await supabase.rpc('delete_ended_events')
  return Response.json({ ok: true, deletedEnded: deleted ?? 0, report })
})
