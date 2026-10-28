import { describe, expect, test } from 'bun:test'
import type { Candidate } from './types.ts'
import { dedupeKey, normalizeTitle, normalizeVenue } from './normalize.ts'
import { runRules } from './rules.ts'
import { mapTicketmasterEvent, tmPrice } from './ticketmaster.ts'
import { parseVEvents, mapVEvent, parseIcalTime } from './adapters/ical.ts'
import { robotsAllows } from './robots.ts'
import { livoniaLink } from './adapters/livonia.ts'
import { localToUtcIso, utcToLocalDate } from './tz.ts'

const now = new Date('2026-10-28T15:00:00Z') // 11:00 in Detroit
const win = { now, end: new Date(now.getTime() + 14 * 86_400_000) }

const base = (o: Partial<Candidate> = {}): Candidate => ({
  sourceName: 'ticketmaster',
  sourceId: '1',
  title: 'Big Show',
  startsAt: '2026-10-30T23:00:00Z',
  endsAt: null,
  allDay: false,
  timezone: 'America/Detroit',
  venue: 'Fox Theatre',
  address: null,
  city: 'Detroit',
  lat: 42.33,
  lng: -83.05,
  priceText: null,
  isFree: false,
  categories: [],
  ageNote: null,
  sourceUrl: 'https://example.com/e/1',
  dateClaims: ['2026-10-30'],
  ...o,
})

describe('normalization', () => {
  test('titles ignore case, punctuation, accents, leading article', () => {
    expect(normalizeTitle('The Café   Show!')).toBe('cafe show')
    expect(normalizeTitle('Rock & Roll')).toBe(normalizeTitle('rock and roll'))
  })
  test('venues normalize likewise', () => {
    expect(normalizeVenue('The Fox Theatre')).toBe('fox theatre')
    expect(normalizeVenue(null)).toBe('')
  })
  test('time zone helpers', () => {
    expect(localToUtcIso('2026-10-30', '19:00:00', 'America/Detroit')).toBe('2026-10-30T23:00:00.000Z')
    expect(localToUtcIso('2026-11-01', '20:00:00', 'America/Detroit')).toBe('2026-11-02T01:00:00.000Z') // EST (UTC-5) after DST ends Nov 1
    expect(utcToLocalDate('2026-10-31T02:00:00Z', 'America/Detroit')).toBe('2026-10-30')
  })
})

describe('accuracy rules', () => {
  const run = (c: Candidate[]) => runRules(c, win, { fetchedAt: now })

  test('keeps a valid event and preserves source_url', () => {
    const { rows, dropped } = run([base()])
    expect(dropped).toEqual([])
    expect(rows[0].source_url).toBe('https://example.com/e/1')
    expect(rows[0].id).toBe('ticketmaster:1')
  })
  test('drops events without a confirmed start', () => {
    const { rows, dropped } = run([base({ startsAt: null, dateClaims: [] })])
    expect(rows).toEqual([])
    expect(dropped[0].reason).toBe('no_confirmed_start')
  })
  test('drops events outside the 14-day window, past and future', () => {
    const past = base({ sourceId: 'p', startsAt: '2026-10-20T23:00:00Z', dateClaims: ['2026-10-20'] })
    const far = base({ sourceId: 'f', startsAt: '2026-11-20T23:00:00Z', dateClaims: ['2026-11-20'] })
    const { dropped } = run([past, far])
    expect(dropped.map((d) => d.reason)).toEqual(['outside_window', 'outside_window'])
  })
  test('keeps an event that started earlier today (local date is today)', () => {
    const early = base({ startsAt: '2026-10-28T13:00:00Z', dateClaims: ['2026-10-28'] })
    expect(run([early]).rows).toHaveLength(1)
  })
  test('drops events whose date fields conflict', () => {
    const { dropped } = run([base({ dateClaims: ['2026-10-30', '2026-10-31'] })])
    expect(dropped[0].reason).toBe('date_conflict')
  })
  test('drops events that end before they start', () => {
    const { dropped } = run([base({ endsAt: '2026-10-30T20:00:00Z' })])
    expect(dropped[0].reason).toBe('date_conflict')
  })
  test('drops events with no source_url', () => {
    expect(run([base({ sourceUrl: null })]).dropped[0].reason).toBe('no_source_url')
  })
  test('drops source-flagged events', () => {
    expect(run([base({ skip: 'cancelled_or_postponed' })]).dropped[0].reason).toBe('cancelled_or_postponed')
  })
  test('drops events outside the radius, keeps those without coordinates', () => {
    const region = { lat: 42.3314, lng: -83.0458, radiusMiles: 15 }
    const far = base({ sourceId: 'far', lat: 41.5, lng: -81.7 }) // Cleveland
    const noCoords = base({ sourceId: 'nc', title: 'Other', lat: null, lng: null })
    const r = runRules([far, noCoords], win, { region, fetchedAt: now })
    expect(r.dropped[0].reason).toBe('outside_radius')
    expect(r.rows.map((x) => x.id)).toEqual(['ticketmaster:nc'])
  })
  test('never invents price or time: unknown stays null / all_day', () => {
    const { rows } = run([base({ allDay: true, priceText: null })])
    expect(rows[0].price_text).toBeNull()
    expect(rows[0].all_day).toBe(true)
  })
  test('free events carry the free category', () => {
    expect(run([base({ isFree: true })]).rows[0].categories).toContain('free')
  })
})

describe('de-dupe', () => {
  test('same normalized title + venue + date collapses to one', () => {
    const a = base({ sourceId: 'a', title: 'The Big Show' })
    const b = base({ sourceId: 'b', sourceName: 'city', title: 'big show!', venue: 'FOX THEATRE' })
    const r = runRules([a, b], win, { fetchedAt: now })
    expect(r.rows).toHaveLength(1)
    expect(r.dropped.filter((d) => d.reason === 'duplicate')).toHaveLength(1)
  })
  test('different date or venue is not a duplicate', () => {
    const a = base({ sourceId: 'a' })
    const b = base({ sourceId: 'b', startsAt: '2026-10-31T23:00:00Z', dateClaims: ['2026-10-31'] })
    const c = base({ sourceId: 'c', venue: 'Other Hall' })
    expect(runRules([a, b, c], win, { fetchedAt: now }).rows).toHaveLength(3)
    expect(dedupeKey(a)).not.toBe(dedupeKey(b))
  })
  test('keeps the more complete duplicate; ties go to source priority', () => {
    const sparse = base({ sourceId: 's' })
    const rich = base({ sourceId: 'r', sourceName: 'city', priceText: '$10' })
    expect(runRules([sparse, rich], win, { fetchedAt: now }).rows[0].id).toBe('city:r')
    const t1 = base({ sourceId: 't1' })
    const t2 = base({ sourceId: 't2', sourceName: 'city' })
    expect(runRules([t2, t1], win, { fetchedAt: now, sourcePriority: ['ticketmaster', 'city'] }).rows[0].id).toBe('ticketmaster:t1')
  })
})

describe('ticketmaster mapping', () => {
  const tm = (o: Record<string, unknown> = {}) => ({
    id: 'Z1',
    name: 'Detroit Pistons vs. Bulls',
    url: 'https://www.ticketmaster.com/event/Z1',
    dates: {
      timezone: 'America/Detroit',
      start: { localDate: '2026-10-30', localTime: '19:00:00', dateTime: '2026-10-30T23:00:00Z' },
      status: { code: 'onsale' },
    },
    classifications: [{ segment: { name: 'Sports' }, genre: { name: 'Basketball' } }],
    priceRanges: [{ currency: 'USD', min: 25, max: 120.5 }],
    _embedded: { venues: [{ name: 'Little Caesars Arena', address: { line1: '2645 Woodward' }, city: { name: 'Detroit' }, location: { latitude: '42.341', longitude: '-83.055' } }] },
    ...o,
  })

  test('maps a normal event', () => {
    const c = mapTicketmasterEvent(tm())
    expect(c.startsAt).toBe('2026-10-30T23:00:00Z')
    expect(c.categories).toEqual(['sports'])
    expect(c.priceText).toBe('$25–$120.50')
    expect(c.venue).toBe('Little Caesars Arena')
    expect(c.lat).toBeCloseTo(42.341)
    expect(runRules([c], win, { fetchedAt: now }).rows).toHaveLength(1)
  })
  test('listing date vs ticket date conflict is dropped', () => {
    const c = mapTicketmasterEvent(tm({ dates: { timezone: 'America/Detroit', start: { localDate: '2026-10-31', localTime: '19:00:00', dateTime: '2026-10-30T23:00:00Z' }, status: { code: 'onsale' } } }))
    expect(runRules([c], win, { fetchedAt: now }).dropped[0].reason).toBe('date_conflict')
  })
  test('TBD date is dropped', () => {
    const c = mapTicketmasterEvent(tm({ dates: { timezone: 'America/Detroit', start: { dateTBD: true }, status: { code: 'onsale' } } }))
    expect(runRules([c], win, { fetchedAt: now }).dropped[0].reason).toBe('no_confirmed_start')
  })
  test('time TBA keeps the date but marks all_day, never invents a time', () => {
    const c = mapTicketmasterEvent(tm({ dates: { timezone: 'America/Detroit', start: { localDate: '2026-10-30', timeTBA: true }, status: { code: 'onsale' } } }))
    expect(c.allDay).toBe(true)
    expect(c.startsAt).toBe('2026-10-30T04:00:00.000Z') // local midnight, not a fabricated showtime
    expect(runRules([c], win, { fetchedAt: now }).rows).toHaveLength(1)
  })
  test('cancelled and postponed are dropped', () => {
    for (const code of ['cancelled', 'postponed']) {
      const c = mapTicketmasterEvent(tm({ dates: { timezone: 'America/Detroit', start: { localDate: '2026-10-30', localTime: '19:00:00', dateTime: '2026-10-30T23:00:00Z' }, status: { code } } }))
      expect(runRules([c], win, { fetchedAt: now }).dropped[0].reason).toBe('cancelled_or_postponed')
    }
  })
  test('missing priceRanges means null price, not free', () => {
    expect(tmPrice({})).toEqual({ priceText: null, isFree: false })
    expect(tmPrice({ priceRanges: [{ currency: 'USD', min: 0, max: 0 }] })).toEqual({ priceText: 'Free', isFree: true })
  })
  test('21+ only from the listing text', () => {
    expect(mapTicketmasterEvent(tm({ info: 'This show is 21 and over.' })).categories).toContain('21+')
    expect(mapTicketmasterEvent(tm()).ageNote).toBeNull()
  })
})

describe('ical adapter parsing', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:1',
    'SUMMARY:Halloween Family Night',
    'DTSTART;TZID=America/Detroit:20261031T180000',
    'DTEND;TZID=America/Detroit:20261031T200000',
    'LOCATION:Main Library\\, 32777 Five Mile',
    'DESCRIPTION: https://example.org/e/1',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:2',
    'SUMMARY:Offices Closed',
    'DTSTART;VALUE=DATE:20261102',
    'DTEND;VALUE=DATE:20261103',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:3',
    'SUMMARY:Weekly Yoga',
    'DTSTART:20261029T140000Z',
    'RRULE:FREQ=WEEKLY',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const opts = { sourceName: 'x', timezone: 'America/Detroit', areaCenter: { lat: 42.33, lng: -83.04 }, defaultCity: 'Detroit', linkFor: (e: { props: Record<string, { value: string }> }) => e.props.DESCRIPTION?.value.trim() ?? null }
  const mapped = parseVEvents(ics).map((e) => mapVEvent(e, opts as never))

  test('timed, all-day and recurring events', () => {
    expect(mapped[0].startsAt).toBe('2026-10-31T22:00:00.000Z')
    expect(mapped[0].categories).toEqual(expect.arrayContaining(['kids', 'seasonal']))
    expect(mapped[0].address).toBe('Main Library, 32777 Five Mile')
    expect(mapped[1].allDay).toBe(true)
    expect(mapped[2].skip).toBe('unsupported_recurrence')
  })
  test('rules: event with no link is dropped, recurring is dropped, rest kept', () => {
    const r = runRules(mapped, win, { fetchedAt: now })
    expect(r.rows.map((x) => x.id)).toEqual(['x:1'])
    expect(r.dropped.map((d) => d.reason).sort()).toEqual(['no_source_url', 'unsupported_recurrence'])
  })
  test('parseIcalTime rejects garbage', () => {
    expect(parseIcalTime('tomorrow', {}, 'America/Detroit')).toBeNull()
  })
})

describe('robots.txt', () => {
  const txt = 'User-agent: *\nDisallow: /private\nAllow: /private/ok\n\nUser-agent: LazyDayBot\nDisallow: /events/'
  test('specific agent group wins over *', () => {
    expect(robotsAllows(txt, 'LazyDayBot/1.0', '/events/feed')).toBe(false)
    expect(robotsAllows(txt, 'OtherBot', '/events/feed')).toBe(true)
  })
  test('longest match wins; empty robots allows', () => {
    expect(robotsAllows(txt, 'OtherBot', '/private/x')).toBe(false)
    expect(robotsAllows(txt, 'OtherBot', '/private/ok')).toBe(true)
    expect(robotsAllows('', 'Any', '/x')).toBe(true)
  })
})

describe('livonia adapter', () => {
  test('finds the event link at the end of a long description', () => {
    expect(livoniaLink('Join us for tea. Registration required for $40. https://www.livonia.gov/calendar.aspx?EID=4720')).toBe('https://www.livonia.gov/calendar.aspx?EID=4720')
    expect(livoniaLink(' https://www.livonia.gov/calendar.aspx?EID=4771')).toBe('https://www.livonia.gov/calendar.aspx?EID=4771')
    expect(livoniaLink('no link here')).toBeNull()
    expect(livoniaLink(undefined)).toBeNull()
  })
})
