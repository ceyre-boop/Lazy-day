import type { Candidate } from '../types.ts'
import { cleanText, kidsFromText, seasonalFromText } from '../normalize.ts'
import { localToUtcIso, utcToLocalDate } from '../tz.ts'

export interface VEvent {
  props: Record<string, { value: string; params: Record<string, string> }>
}

export function unfold(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
}

export function parseVEvents(ics: string): VEvent[] {
  const events: VEvent[] = []
  let cur: VEvent | null = null
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') cur = { props: {} }
    else if (line === 'END:VEVENT') {
      if (cur) events.push(cur)
      cur = null
    } else if (cur) {
      const colon = line.indexOf(':')
      if (colon < 0) continue
      const [name, ...paramParts] = line.slice(0, colon).split(';')
      const params: Record<string, string> = {}
      for (const p of paramParts) {
        const [k, v] = p.split('=')
        if (k && v) params[k.toUpperCase()] = v
      }
      cur.props[name.toUpperCase()] = { value: line.slice(colon + 1), params }
    }
  }
  return events
}

export function unescapeText(s: string): string {
  return s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1')
}

export interface IcalTime {
  /** UTC instant; for DATE values this is local midnight. */
  iso: string
  dateOnly: boolean
  /** Local date the field itself states (for DATE / floating / TZID values). null for UTC "Z" values. */
  localDate: string | null
}

export function parseIcalTime(value: string, params: Record<string, string>, fallbackTz: string): IcalTime | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (m[4] === undefined) {
    return { iso: localToUtcIso(date, null, fallbackTz), dateOnly: true, localDate: date }
  }
  const time = `${m[4]}:${m[5]}:${m[6] ?? '00'}`
  if (m[7]) return { iso: `${date}T${time}Z`, dateOnly: false, localDate: null }
  const tz = params.TZID ?? fallbackTz
  try {
    return { iso: localToUtcIso(date, time, tz), dateOnly: false, localDate: date }
  } catch {
    return null
  }
}

export interface IcalMapOptions {
  sourceName: string
  timezone: string
  /** Centroid of the jurisdiction; used only for radius filtering when the feed has no coordinates. */
  areaCenter: { lat: number; lng: number }
  defaultCity: string | null
  /** Resolve a link for the event when the feed's URL property is relative or absent. */
  linkFor: (ev: VEvent) => string | null
}

export function mapVEvent(ev: VEvent, o: IcalMapOptions): Candidate {
  const p = ev.props
  const title = cleanText(unescapeText(p.SUMMARY?.value ?? '')) ?? ''
  const start = p.DTSTART ? parseIcalTime(p.DTSTART.value, p.DTSTART.params, o.timezone) : null
  const end = p.DTEND ? parseIcalTime(p.DTEND.value, p.DTEND.params, o.timezone) : null
  const loc = cleanText(unescapeText(p.LOCATION?.value ?? '').replace(/^[-\s,]+/, ''))
  const geo = p.GEO?.value.split(';').map(Number)
  const text = `${title} ${p.CATEGORIES?.value ?? ''}`
  const categories: Candidate['categories'] = []
  if (kidsFromText(text)) categories.push('kids')
  if (seasonalFromText(text)) categories.push('seasonal')

  const hasRrule = Boolean(p.RRULE)
  return {
    sourceName: o.sourceName,
    sourceId: p.UID?.value ?? `${title}@${p.DTSTART?.value ?? ''}`,
    title,
    startsAt: start?.iso ?? null,
    endsAt: end?.iso ?? null,
    allDay: start?.dateOnly ?? false,
    timezone: o.timezone,
    venue: null, // iCal LOCATION is free text; never guess a venue/city split.
    address: loc,
    city: loc ? o.defaultCity : null,
    lat: geo && geo.length === 2 && geo.every(Number.isFinite) ? geo[0] : o.areaCenter.lat,
    lng: geo && geo.length === 2 && geo.every(Number.isFinite) ? geo[1] : o.areaCenter.lng,
    priceText: null,
    isFree: false,
    categories,
    ageNote: null,
    sourceUrl: o.linkFor(ev),
    dateClaims: start ? [start.localDate ?? utcToLocalDate(start.iso, o.timezone)] : [],
    skip: hasRrule ? 'unsupported_recurrence' : undefined,
  }
}
