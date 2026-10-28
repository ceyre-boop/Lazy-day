import type { Candidate, Category, Region } from './types.ts'
import { cleanText, kidsFromText, seasonalFromText } from './normalize.ts'
import { localToUtcIso, utcToLocalDate } from './tz.ts'

// deno-lint-ignore no-explicit-any
type TM = any

export const TICKETMASTER = 'ticketmaster'

function money(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`
}

/** Price text only from the listing's own priceRanges; null (shown as "See details") otherwise. */
export function tmPrice(e: TM): { priceText: string | null; isFree: boolean } {
  const ranges: TM[] = (e.priceRanges ?? []).filter(
    (r: TM) => (r.currency ?? 'USD') === 'USD' && typeof r.min === 'number' && typeof r.max === 'number',
  )
  if (ranges.length === 0) return { priceText: null, isFree: false }
  const min = Math.min(...ranges.map((r) => r.min))
  const max = Math.max(...ranges.map((r) => r.max))
  if (max === 0) return { priceText: 'Free', isFree: true }
  return { priceText: min === max ? money(min) : `${money(min)}–${money(max)}`, isFree: false }
}

export function tmCategories(e: TM): Category[] {
  const out = new Set<Category>()
  const cl = (e.classifications ?? [])[0] ?? {}
  const segment = cl.segment?.name
  const genre = cl.genre?.name ?? ''
  const sub = cl.subGenre?.name ?? ''
  if (segment === 'Music') out.add('music')
  if (segment === 'Sports') out.add('sports')
  if (segment === 'Arts & Theatre' || segment === 'Film') out.add('shows')
  const text = `${e.name ?? ''} ${genre} ${sub}`
  if (cl.family === true || /children|family/i.test(`${genre} ${sub}`) || kidsFromText(e.name ?? '')) out.add('kids')
  if (seasonalFromText(text)) out.add('seasonal')
  return [...out]
}

/** "21+" / "21 and over" only when the listing's own text says so. */
export function tmAgeNote(e: TM): string | null {
  const text = `${e.ageRestrictions?.legalAgeEnforced ? 'age restricted ' : ''}${e.info ?? ''} ${e.pleaseNote ?? ''}`
  const m = text.match(/\b(21|18)\s*(\+|and over|& over|and older)/i)
  return m ? `${m[1]}+` : null
}

export function mapTicketmasterEvent(e: TM): Candidate {
  const start = e.dates?.start ?? {}
  const venue = e._embedded?.venues?.[0] ?? {}
  const tz: string | null = e.dates?.timezone ?? venue.timezone ?? null
  const status: string = e.dates?.status?.code ?? 'onsale'
  const { priceText, isFree } = tmPrice(e)
  const age = tmAgeNote(e)
  const categories = tmCategories(e)
  if (age === '21+') categories.push('21+')

  const dateUnconfirmed = start.dateTBD === true || start.dateTBA === true || !start.localDate
  const timeUnknown = start.timeTBA === true || start.noSpecificTime === true || !start.localTime
  const claims: string[] = []
  let startsAt: string | null = null
  let allDay = false

  if (!dateUnconfirmed) {
    if (start.localDate) claims.push(start.localDate)
    if (start.dateTime && tz) claims.push(utcToLocalDate(start.dateTime, tz))
    if (!timeUnknown && start.dateTime) {
      startsAt = start.dateTime
    } else if (!timeUnknown && start.localTime && tz) {
      startsAt = localToUtcIso(start.localDate, start.localTime, tz)
    } else if (tz) {
      // Date confirmed, time not: keep the date, flag all_day, never invent a time.
      startsAt = localToUtcIso(start.localDate, null, tz)
      allDay = true
    }
  }

  const endIso: string | null = e.dates?.end?.dateTime ?? null
  const lat = Number.parseFloat(venue.location?.latitude)
  const lng = Number.parseFloat(venue.location?.longitude)
  const cancelled = ['cancelled', 'canceled', 'postponed', 'rescheduled'].includes(status.toLowerCase())

  return {
    sourceName: TICKETMASTER,
    sourceId: String(e.id),
    title: cleanText(e.name) ?? '',
    startsAt,
    endsAt: endIso,
    allDay,
    timezone: tz,
    venue: cleanText(venue.name),
    address: cleanText(venue.address?.line1),
    city: cleanText(venue.city?.name),
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    priceText,
    isFree,
    categories,
    ageNote: age,
    sourceUrl: cleanText(e.url),
    dateClaims: claims,
    skip: cancelled ? 'cancelled_or_postponed' : undefined,
  }
}

export interface TmOptions {
  apiKey: string
  region: Region
  from: Date
  to: Date
  fetchFn?: typeof fetch
  sleepMs?: number
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

/** One query per UTC day so the 1000-result deep-paging cap never truncates a big metro. */
export async function fetchTicketmaster(opts: TmOptions): Promise<{ events: TM[]; errors: string[] }> {
  const f = opts.fetchFn ?? fetch
  const sleep = opts.sleepMs ?? 220 // API limit: 5 requests/second
  const events: TM[] = []
  const errors: string[] = []
  const DAY = 86_400_000
  for (let t = opts.from.getTime(); t < opts.to.getTime(); t += DAY) {
    const dayStart = new Date(t)
    const dayEnd = new Date(Math.min(t + DAY - 1000, opts.to.getTime()))
    for (let page = 0; page < 5; page++) {
      const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json')
      url.search = new URLSearchParams({
        apikey: opts.apiKey,
        latlong: `${opts.region.lat},${opts.region.lng}`,
        radius: String(opts.region.radiusMiles),
        unit: 'miles',
        startDateTime: iso(dayStart),
        endDateTime: iso(dayEnd),
        size: '200',
        page: String(page),
        sort: 'date,asc',
        includeTest: 'no',
      }).toString()
      await new Promise((r) => setTimeout(r, sleep))
      const res = await f(url)
      if (!res.ok) {
        errors.push(`ticketmaster ${iso(dayStart)} page ${page}: HTTP ${res.status}`)
        break
      }
      const json = await res.json()
      events.push(...(json._embedded?.events ?? []))
      if (page + 1 >= (json.page?.totalPages ?? 0)) break
    }
  }
  return { events, errors }
}
