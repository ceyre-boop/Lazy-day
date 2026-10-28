export type Category = 'kids' | 'free' | 'music' | 'sports' | 'shows' | 'seasonal' | '21+'

export type DropReason =
  | 'no_confirmed_start'
  | 'outside_window'
  | 'date_conflict'
  | 'cancelled_or_postponed'
  | 'unsupported_recurrence'
  | 'no_source_url'
  | 'outside_radius'
  | 'duplicate'
  | 'not_fetched'
  | 'date_not_on_page'
  | 'recurring_no_date'
  | 'invalid_ai_output'
  | 'no_location'

/** What a source (Ticketmaster or an adapter) hands to the pipeline, before the accuracy rules run. */
export interface Candidate {
  sourceName: string
  sourceId: string
  title: string
  /** ISO UTC instant. null when the source has no confirmed start. */
  startsAt: string | null
  endsAt: string | null
  /** True when the source gave a date but no time of day. */
  allDay: boolean
  /** IANA zone the event happens in, used to resolve "today" and the local start date. */
  timezone: string | null
  venue: string | null
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
  priceText: string | null
  isFree: boolean
  categories: Category[]
  ageNote: string | null
  sourceUrl: string | null
  /** Every YYYY-MM-DD local date the listing asserts (different fields). They must all agree. */
  dateClaims: string[]
  /** Set by a source to force a drop with a specific reason. */
  skip?: DropReason
  /** Human-readable detail for `skip`, used in the drop log. */
  skipDetail?: string
}

export interface EventRow {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  venue: string | null
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
  price_text: string | null
  is_free: boolean
  categories: Category[]
  age_note: string | null
  source_name: string
  source_url: string
  fetched_at: string
}

export interface Dropped {
  sourceName: string
  sourceId: string
  title: string
  reason: DropReason
  detail: string
}

export interface Region {
  lat: number
  lng: number
  radiusMiles: number
  /** Human name for prompts, e.g. "Detroit, MI". */
  label?: string
  /** IANA zone the region's events happen in. Defaults to America/New_York. */
  timezone?: string
}

export interface Window {
  now: Date
  end: Date
}
