import type { Candidate, Dropped, DropReason, EventRow, Region, Window } from './types.ts'
import { dedupeKey, haversineMiles } from './normalize.ts'
import { utcToLocalDate } from './tz.ts'

function drop(c: Candidate, reason: DropReason, detail: string): Dropped {
  return { sourceName: c.sourceName, sourceId: c.sourceId, title: c.title, reason, detail }
}

/**
 * Returns a reason when the candidate must be dropped, else null.
 * Order matters: the first failing rule is the reported reason.
 */
export function checkAccuracy(c: Candidate, win: Window, region?: Region): Dropped | null {
  if (c.skip) return drop(c, c.skip, `source flagged event as ${c.skip}`)

  if (!c.sourceUrl) return drop(c, 'no_source_url', 'listing has no source_url')

  if (!c.startsAt || Number.isNaN(Date.parse(c.startsAt))) {
    return drop(c, 'no_confirmed_start', 'no confirmed start date')
  }
  const start = new Date(c.startsAt)

  // Conflicting date claims across fields.
  if (new Set(c.dateClaims).size > 1) {
    return drop(c, 'date_conflict', `fields disagree on date: ${[...new Set(c.dateClaims)].join(' vs ')}`)
  }
  if (c.endsAt) {
    const end = Date.parse(c.endsAt)
    if (Number.isNaN(end) || end < start.getTime()) {
      return drop(c, 'date_conflict', `ends_at ${c.endsAt} is before starts_at ${c.startsAt}`)
    }
  }

  // Window: start date must be today (event-local) or later, and before the window end.
  const tz = c.timezone ?? 'UTC'
  const today = utcToLocalDate(win.now, tz)
  const startLocal = utcToLocalDate(start, tz)
  const startsInWindow = c.dateClaims.length > 0 ? c.dateClaims[0] : startLocal
  if (startsInWindow < today || start.getTime() >= win.end.getTime()) {
    return drop(c, 'outside_window', `start ${c.startsAt} is outside the 14-day window`)
  }

  if (region && c.lat != null && c.lng != null) {
    const d = haversineMiles(region.lat, region.lng, c.lat, c.lng)
    if (d > region.radiusMiles) {
      return drop(c, 'outside_radius', `${d.toFixed(1)} mi from center, radius ${region.radiusMiles} mi`)
    }
  }
  return null
}

/** Rough richness score: the more verified fields, the better the duplicate to keep. */
function completeness(c: Candidate): number {
  return [c.priceText, c.endsAt, c.address, c.venue, c.ageNote, c.lat, c.categories.length > 0 ? 1 : null].filter(
    (v) => v != null,
  ).length
}

export interface Pipeline {
  rows: EventRow[]
  dropped: Dropped[]
}

/**
 * Accuracy rules, then de-dupe, then row mapping.
 * `sourcePriority` breaks ties between equally complete duplicates (earlier wins).
 */
export function runRules(
  candidates: Candidate[],
  win: Window,
  opts: { region?: Region; fetchedAt?: Date; sourcePriority?: string[] } = {},
): Pipeline {
  const dropped: Dropped[] = []
  const survivors: Candidate[] = []
  for (const c of candidates) {
    const d = checkAccuracy(c, win, opts.region)
    if (d) dropped.push(d)
    else survivors.push(c)
  }

  const priority = (c: Candidate) => {
    const i = (opts.sourcePriority ?? []).indexOf(c.sourceName)
    return i === -1 ? 999 : i
  }
  const winners = new Map<string, Candidate>()
  for (const c of survivors) {
    const key = dedupeKey(c)
    const cur = winners.get(key)
    if (!cur) {
      winners.set(key, c)
      continue
    }
    const better =
      completeness(c) > completeness(cur) || (completeness(c) === completeness(cur) && priority(c) < priority(cur))
    const [keep, lose] = better ? [c, cur] : [cur, c]
    winners.set(key, keep)
    dropped.push(drop(lose, 'duplicate', `duplicate of ${keep.sourceName}:${keep.sourceId}`))
  }

  const fetchedAt = (opts.fetchedAt ?? new Date()).toISOString()
  const rows = [...winners.values()].map((c) => toRow(c, fetchedAt))
  return { rows, dropped }
}

export function toRow(c: Candidate, fetchedAt: string): EventRow {
  return {
    id: `${c.sourceName}:${c.sourceId}`,
    title: c.title,
    starts_at: new Date(c.startsAt!).toISOString(),
    ends_at: c.endsAt ? new Date(c.endsAt).toISOString() : null,
    all_day: c.allDay,
    venue: c.venue,
    address: c.address,
    city: c.city,
    lat: c.lat,
    lng: c.lng,
    price_text: c.priceText,
    is_free: c.isFree,
    categories: [...new Set(c.isFree ? [...c.categories, 'free' as const] : c.categories)],
    age_note: c.ageNote,
    source_name: c.sourceName,
    source_url: c.sourceUrl!,
    fetched_at: fetchedAt,
  }
}
