import type { Candidate, Region } from '../types.ts'

export interface AdapterContext {
  region: Region
  from: Date
  to: Date
  /** robots.txt-checked GET. Adapters must use this, never raw fetch. */
  get: (url: string) => Promise<string>
}

/**
 * A pluggable local-calendar source. Prefer official iCal/RSS/JSON feeds.
 * Return Candidates; the pipeline applies every accuracy rule afterward.
 */
export interface SourceAdapter {
  /** Stable id; becomes source_name. */
  name: string
  /** Area the feed serves. The runner skips the adapter for regions that don't overlap it. */
  coverage: Region
  fetch(ctx: AdapterContext): Promise<Candidate[]>
}
