import type { Candidate } from '../types.ts'
import { cleanText } from '../normalize.ts'
import { localToUtcIso } from '../tz.ts'
import type { AiEvent, InvalidItem } from './schema.ts'
import { validateAiEvent } from './schema.ts'
import { normalizeUrl, type FetchedPage } from './pages.ts'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Does `text` state the date `iso` (YYYY-MM-DD) in a common written form? Year is optional. */
export function dateAppearsIn(text: string, iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number)
  const t = squash(text)
  const day = `0?${d}(?:st|nd|rd|th)?`
  const mi = m - 1
  const mon = `(?:${MONTH_FULL[mi]}|${MONTHS[mi]}(?:t)?\\.?)`
  const patterns = [
    `\\b${y}-0?${m}-0?${d}\\b`,
    `\\b${mon}\\s+${day}\\b`,
    `\\b${day}\\s+(?:of\\s+)?${mon}\\b`,
    `\\b0?${m}/0?${d}(?:/(?:${y}|${String(y).slice(2)}))?\\b`,
    `\\b0?${m}-0?${d}-(?:${y}|${String(y).slice(2)})\\b`,
  ]
  return patterns.some((p) => new RegExp(p).test(t))
}

/** Does `text` state the 24h time `hhmm` ("19:30") as 7:30 pm / 19:30? */
export function timeAppearsIn(text: string, hhmm: string): boolean {
  const [H, M] = hhmm.split(':').map(Number)
  const t = squash(text)
  const h12 = H % 12 === 0 ? 12 : H % 12
  const mer = H >= 12 ? 'p' : 'a'
  const mm = String(M).padStart(2, '0')
  const twelve =
    M === 0
      ? `\\b${h12}(?::00)?\\s*${mer}\\.?m\\b\\.?`
      : `\\b${h12}:${mm}\\s*${mer}\\.?m\\b\\.?`
  const twentyFour = `\\b${String(H).padStart(2, '0')}:${mm}\\b`
  return new RegExp(`${twelve}|${twentyFour}`).test(t)
}

function priceOnPage(price: string, text: string): boolean {
  const t = squash(text)
  const nums = price.match(/\d+(?:\.\d+)?/g)
  if (!nums) return t.includes(squash(price))
  return nums.every((n) => t.includes(n))
}

function ageOnPage(note: string, text: string): string | null {
  const m = note.match(/(\d{2})\s*(\+|and over|and older|& over)/i)
  if (!m) return null
  const n = m[1]
  return new RegExp(`\\b${n}\\s*(\\+|and over|and older|& over|years)`, 'i').test(text) ? `${n}+` : null
}

export interface VerifyOptions {
  timezone: string
  pages: Map<string, FetchedPage>
  /** Street address -> coordinates. Injected so tests and Deno share the logic. */
  geocode: (address: string) => Promise<{ lat: number; lng: number } | null>
}

function placeholder(raw: unknown, reason: string, detail: string, title?: string | null): Candidate {
  const o = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>
  return {
    sourceName: 'ai-search',
    sourceId: `invalid:${Math.abs(hash(JSON.stringify(raw ?? null)))}`,
    title: title ?? (typeof o.title === 'string' ? o.title : '(untitled)'),
    startsAt: null,
    endsAt: null,
    allDay: false,
    timezone: null,
    venue: null,
    address: null,
    city: null,
    lat: null,
    lng: null,
    priceText: null,
    isFree: false,
    categories: [],
    ageNote: null,
    sourceUrl: typeof o.source_url === 'string' ? o.source_url : null,
    dateClaims: [],
    skip: reason as Candidate['skip'],
    skipDetail: detail,
  }
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return h
}

/**
 * Turn the model's items into Candidates. Anything the page does not back up becomes a Candidate with
 * `skip` set, so it flows through the same drop log as every other source. Window, date-conflict and
 * de-dupe rules still run afterward in runRules.
 */
export async function verifyAiEvents(items: unknown[], o: VerifyOptions): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const raw of items) {
    const v = validateAiEvent(raw)
    if (!v.ok) {
      out.push(placeholder(raw, 'invalid_ai_output', v.reason))
      continue
    }
    out.push(await verifyOne(v.event, raw, o))
  }
  return out
}

async function verifyOne(e: AiEvent, raw: unknown, o: VerifyOptions): Promise<Candidate> {
  const fail = (reason: Candidate['skip'], detail: string) => placeholder(raw, reason!, detail, e.title)

  if (!e.start_date) {
    return fail(e.recurring ? 'recurring_no_date' : 'no_confirmed_start', e.recurring ? 'recurring listing without a specific date' : 'no start date')
  }

  const page = o.pages.get(normalizeUrl(e.source_url))
  if (!page) return fail('not_fetched', `source_url was not fetched by web_fetch: ${e.source_url}`)
  if (page.text === null) return fail('date_not_on_page', 'page text unavailable (PDF/binary), date cannot be verified')

  const evidence = squash(e.date_evidence)
  if (!squash(page.text).includes(evidence)) return fail('date_not_on_page', 'date_evidence is not text from the fetched page')
  if (!dateAppearsIn(e.date_evidence, e.start_date)) return fail('date_not_on_page', `date_evidence does not state ${e.start_date}`)
  if (!dateAppearsIn(page.text, e.start_date)) return fail('date_not_on_page', `${e.start_date} does not appear on the page`)

  // Time, price, age and free are kept only when the page states them. Otherwise they stay unknown.
  const time = e.start_time && timeAppearsIn(page.text, e.start_time) ? e.start_time : null
  const endTime = time && e.end_time && timeAppearsIn(page.text, e.end_time) ? e.end_time : null
  const priceText = e.price_text && priceOnPage(e.price_text, page.text) ? e.price_text : null
  const isFree = e.is_free === true && /\bfree\b/i.test(page.text) && (priceText === null || /free/i.test(priceText))
  const ageNote = e.age_note ? ageOnPage(e.age_note, page.text) : null
  const categories = e.categories.filter((c) => (c === '21+' ? ageNote === '21+' : c === 'free' ? isFree : true))

  // Location: street address geocoded by the Census geocoder; model coordinates only as a fallback.
  let lat = e.lat
  let lng = e.lng
  const fullAddress = [e.address, e.city].filter(Boolean).join(', ')
  if (e.address) {
    const g = await o.geocode(fullAddress)
    if (g) {
      lat = g.lat
      lng = g.lng
    }
  }
  if (lat == null || lng == null) return fail('no_location', 'could not locate the venue (no geocodable address)')

  const endDate = e.end_date ?? e.start_date
  return {
    sourceName: 'ai-search',
    sourceId: normalizeUrl(e.source_url) + '#' + e.start_date + (time ?? ''),
    title: cleanText(e.title) ?? '',
    startsAt: localToUtcIso(e.start_date, time, o.timezone),
    // An end is recorded only when the page states an end time; no end time is ever invented.
    endsAt: endTime ? localToUtcIso(endDate, endTime, o.timezone) : null,
    allDay: time === null,
    timezone: o.timezone,
    venue: e.venue,
    address: e.address,
    city: e.city,
    lat,
    lng,
    priceText: isFree ? 'Free' : priceText,
    isFree,
    categories,
    ageNote,
    sourceUrl: e.source_url,
    dateClaims: [e.start_date],
  }
}
