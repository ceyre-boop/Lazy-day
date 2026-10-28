// Dry run of the production pipeline (no database writes).
// Usage: bun scripts/run-fetcher.ts [lat lng radiusMiles]   (default: Detroit, MI 42.3314 -83.0458 15)
import { runRegion } from '../supabase/functions/_shared/run.ts'

const [lat = '42.3314', lng = '-83.0458', radius = '15'] = process.argv.slice(2)
const region = { lat: Number(lat), lng: Number(lng), radiusMiles: Number(radius) }
const r = await runRegion(region, { ticketmasterKey: process.env.TICKETMASTER_API_KEY })

console.log(`Region ${region.lat},${region.lng} @ ${region.radiusMiles} mi`)
console.log(`Fetched: ${r.fetchedCount}  Kept: ${r.rows.length}  Dropped: ${r.dropped.length}`)
console.log('Fetched by source:', r.fetchedBySource)
if (r.sourceErrors.length) console.log('Source errors/skips:', r.sourceErrors)

const byReason: Record<string, number> = {}
for (const d of r.dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1
console.log('Dropped by reason:', byReason)
console.log('\nDropped events:')
for (const d of r.dropped) console.log(`- [${d.reason}] ${d.sourceName}:${d.sourceId} "${d.title}" — ${d.detail}`)
console.log('\nKept events:')
for (const e of r.rows) console.log(`- ${e.starts_at} ${e.all_day ? '(date only) ' : ''}${e.title} @ ${e.venue ?? e.address ?? '?'} [${e.source_name}] ${e.source_url}`)
