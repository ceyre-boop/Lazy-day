// Dry run of the production pipeline (no database writes).
// Usage: bun scripts/run-fetcher.ts [lat lng radiusMiles] [--label "Detroit, MI"] [--tz America/Detroit]
// Defaults: Detroit, MI 42.3314 -83.0458 15. Needs ANTHROPIC_API_KEY; spends real money (printed at the end).
import { runRegion } from '../supabase/functions/_shared/run.ts'
import { createAnthropicRunner } from '../supabase/functions/_shared/ai-search/client.ts'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args.splice(i, 2)[1] : undefined
}
const label = flag('--label') ?? 'Detroit, MI'
const timezone = flag('--tz') ?? 'America/Detroit'
const [lat = '42.3314', lng = '-83.0458', radius = '15'] = args
const region = { lat: Number(lat), lng: Number(lng), radiusMiles: Number(radius), label, timezone }

const key = process.env.ANTHROPIC_API_KEY
const r = await runRegion(region, {
  aiRunner: key ? createAnthropicRunner(key) : undefined,
  enableTicketmaster: process.env.ENABLE_TICKETMASTER === 'true',
  ticketmasterKey: process.env.TICKETMASTER_API_KEY,
})

console.log(`Region ${label} ${region.lat},${region.lng} @ ${region.radiusMiles} mi`)
console.log(`Fetched: ${r.fetchedCount}  Kept: ${r.rows.length}  Dropped: ${r.dropped.length}`)
console.log('Fetched by source:', r.fetchedBySource)
if (r.sourceErrors.length) console.log('Source errors/skips:', r.sourceErrors)

const byReason: Record<string, number> = {}
for (const d of r.dropped) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1
console.log('Dropped by reason:', byReason)
console.log('\nDropped events:')
for (const d of r.dropped) console.log(`- [${d.reason}] ${d.sourceName} "${d.title}" — ${d.detail}`)
console.log('\nKept events:')
for (const e of r.rows) console.log(`- ${e.starts_at} ${e.all_day ? '(date only) ' : ''}${e.title} @ ${e.venue ?? e.address ?? '?'} [${e.source_name}] ${e.source_url}`)

if (r.aiSearch) {
  const a = r.aiSearch
  console.log(`\nai-search: ${a.turns} turn(s), ${a.usage.web_search_requests} searches, ${a.fetchedPages} pages fetched, ${a.modelItems} items from model`)
  console.log(`tokens in/out/cache-write/cache-read: ${a.usage.input_tokens}/${a.usage.output_tokens}/${a.usage.cache_creation_input_tokens}/${a.usage.cache_read_input_tokens}`)
  console.log(`COST: $${a.costUsd.toFixed(4)} (list price: tokens at $2/$10 per MTok + $10 per 1,000 searches)`)
}
