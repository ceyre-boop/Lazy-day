import type { Candidate, Dropped, EventRow, Region } from './types.ts'
import { runRules } from './rules.ts'
import { fetchTicketmaster, mapTicketmasterEvent, TICKETMASTER } from './ticketmaster.ts'
import { adapters as defaultAdapters } from './adapters/index.ts'
import type { SourceAdapter } from './adapters/types.ts'
import { createPoliteGet } from './robots.ts'
import { haversineMiles } from './normalize.ts'

export const WINDOW_DAYS = 14

export interface RunDeps {
  ticketmasterKey?: string
  adapters?: SourceAdapter[]
  fetchFn?: typeof fetch
  now?: Date
}

export interface RegionResult {
  rows: EventRow[]
  dropped: Dropped[]
  fetchedCount: number
  fetchedBySource: Record<string, number>
  /** Sources that completed without error (safe to prune unseen rows for). */
  okSources: string[]
  sourceErrors: string[]
}

export async function runRegion(region: Region, deps: RunDeps = {}): Promise<RegionResult> {
  const now = deps.now ?? new Date()
  const end = new Date(now.getTime() + WINDOW_DAYS * 86_400_000)
  const candidates: Candidate[] = []
  const fetchedBySource: Record<string, number> = {}
  const okSources: string[] = []
  const sourceErrors: string[] = []

  if (deps.ticketmasterKey) {
    try {
      const { events, errors } = await fetchTicketmaster({
        apiKey: deps.ticketmasterKey,
        region,
        from: now,
        to: end,
        fetchFn: deps.fetchFn,
      })
      candidates.push(...events.map(mapTicketmasterEvent))
      fetchedBySource[TICKETMASTER] = events.length
      if (errors.length === 0) okSources.push(TICKETMASTER)
      sourceErrors.push(...errors)
    } catch (e) {
      sourceErrors.push(`ticketmaster: ${(e as Error).message}`)
    }
  } else {
    sourceErrors.push('ticketmaster: skipped, TICKETMASTER_API_KEY not set')
  }

  const get = createPoliteGet(deps.fetchFn)
  for (const a of deps.adapters ?? defaultAdapters) {
    if (haversineMiles(region.lat, region.lng, a.coverage.lat, a.coverage.lng) > region.radiusMiles + a.coverage.radiusMiles) {
      continue // adapter's area doesn't overlap this region
    }
    try {
      const got = await a.fetch({ region, from: now, to: end, get })
      candidates.push(...got)
      fetchedBySource[a.name] = got.length
      okSources.push(a.name)
    } catch (e) {
      sourceErrors.push(`${a.name}: ${(e as Error).message}`)
    }
  }

  const { rows, dropped } = runRules(candidates, { now, end }, {
    region,
    fetchedAt: now,
    sourcePriority: [TICKETMASTER, ...(deps.adapters ?? defaultAdapters).map((a) => a.name)],
  })
  return { rows, dropped, fetchedCount: candidates.length, fetchedBySource, okSources, sourceErrors }
}
