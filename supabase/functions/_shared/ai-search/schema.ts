import type { Category } from '../types.ts'

/** One event as the model must return it (strict JSON). */
export interface AiEvent {
  title: string
  start_date: string | null // YYYY-MM-DD, local
  start_time: string | null // HH:MM 24h, local; null when the page gives no time
  end_date: string | null
  end_time: string | null
  venue: string | null
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
  price_text: string | null
  is_free: boolean | null
  age_note: string | null
  categories: Category[]
  source_url: string
  /** Verbatim text copied from the fetched page that shows the date. */
  date_evidence: string
  /** True when the listing is a repeating series. A specific date for this occurrence is still required. */
  recurring: boolean
}

export const CATEGORIES: Category[] = ['kids', 'free', 'music', 'sports', 'shows', 'seasonal', '21+']

/** The JSON shape described to the model in the prompt. */
export const SCHEMA_PROMPT = `{
  "events": [
    {
      "title": string,
      "start_date": "YYYY-MM-DD" | null,
      "start_time": "HH:MM" (24h, local) | null,
      "end_date": "YYYY-MM-DD" | null,
      "end_time": "HH:MM" | null,
      "venue": string | null,
      "address": string | null,
      "city": string | null,
      "lat": number | null,
      "lng": number | null,
      "price_text": string | null,
      "is_free": boolean | null,
      "age_note": string | null,
      "categories": ("kids"|"free"|"music"|"sports"|"shows"|"seasonal"|"21+")[],
      "source_url": string,
      "date_evidence": string,
      "recurring": boolean
    }
  ]
}`

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export interface InvalidItem {
  raw: unknown
  title: string | null
  reason: string
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const strOrNull = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : undefined

/** Validate one raw item. Returns the typed event or a reason it is invalid. */
export function validateAiEvent(raw: unknown): { ok: true; event: AiEvent } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'not an object' }
  const o = raw as Record<string, unknown>
  if (!isStr(o.title)) return { ok: false, reason: 'title missing' }
  if (!isStr(o.source_url) || !/^https?:\/\//i.test(o.source_url)) return { ok: false, reason: 'source_url missing or not http(s)' }
  if (!isStr(o.date_evidence)) return { ok: false, reason: 'date_evidence missing' }
  if (typeof o.recurring !== 'boolean') return { ok: false, reason: 'recurring must be boolean' }

  const date = (k: string): string | null | undefined => {
    const v = o[k]
    if (v === null || v === undefined) return null
    return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined
  }
  const time = (k: string): string | null | undefined => {
    const v = o[k]
    if (v === null || v === undefined) return null
    return typeof v === 'string' && TIME.test(v) ? v : undefined
  }
  const start_date = date('start_date')
  const end_date = date('end_date')
  const start_time = time('start_time')
  const end_time = time('end_time')
  if (start_date === undefined) return { ok: false, reason: 'start_date is not YYYY-MM-DD' }
  if (end_date === undefined) return { ok: false, reason: 'end_date is not YYYY-MM-DD' }
  if (start_time === undefined) return { ok: false, reason: 'start_time is not HH:MM' }
  if (end_time === undefined) return { ok: false, reason: 'end_time is not HH:MM' }

  const venue = strOrNull(o.venue)
  const address = strOrNull(o.address)
  const city = strOrNull(o.city)
  const price_text = strOrNull(o.price_text)
  const age_note = strOrNull(o.age_note)
  if ([venue, address, city, price_text, age_note].some((v) => v === undefined)) {
    return { ok: false, reason: 'a text field has the wrong type' }
  }
  const num = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const lat = num(o.lat)
  const lng = num(o.lng)
  if (lat === undefined || lng === undefined) return { ok: false, reason: 'lat/lng must be numbers or null' }
  if (o.is_free !== null && o.is_free !== undefined && typeof o.is_free !== 'boolean') {
    return { ok: false, reason: 'is_free must be boolean or null' }
  }
  if (!Array.isArray(o.categories)) return { ok: false, reason: 'categories must be an array' }

  return {
    ok: true,
    event: {
      title: o.title.trim(),
      start_date,
      start_time,
      end_date,
      end_time,
      venue: venue!,
      address: address!,
      city: city!,
      lat,
      lng,
      price_text: price_text!,
      is_free: (o.is_free as boolean | null | undefined) ?? null,
      age_note: age_note!,
      // Unknown category labels are ignored rather than failing the whole event.
      categories: o.categories.filter((c): c is Category => CATEGORIES.includes(c as Category)),
      source_url: o.source_url.trim(),
      date_evidence: o.date_evidence.trim(),
      recurring: o.recurring,
    },
  }
}

/** Pull the JSON object out of the model's final text (tolerates ```json fences and stray prose). */
export function parseAiJson(text: string): { events: unknown[] } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in model output')
  const parsed = JSON.parse(body.slice(start, end + 1))
  if (!parsed || !Array.isArray(parsed.events)) throw new Error('JSON has no "events" array')
  return parsed
}
