import { describe, expect, test } from 'bun:test'
import { dayHeader, dayKey, addDays, filterEvents, groupByDay, noteLabel, timeLabel } from './events'
import type { AppEvent } from './types'

const now = new Date(2026, 9, 28, 12, 0) // local Oct 28 2026
const ev = (o: Partial<AppEvent>): AppEvent => ({
  id: 'x', title: 't', starts_at: new Date(2026, 9, 28, 19, 0).toISOString(), ends_at: null, all_day: false,
  venue: null, address: null, city: null, lat: null, lng: null, price_text: null, is_free: false,
  categories: [], age_note: null, source_name: 's', source_url: 'https://e', fetched_at: '2026-10-28T10:00:00Z', ...o,
})

describe('filters', () => {
  const kidsFree = ev({ id: 'a', categories: ['kids', 'free'], is_free: true })
  const kids = ev({ id: 'b', categories: ['kids'] })
  const music = ev({ id: 'c', categories: ['music', '21+'] })
  const tomorrow = ev({ id: 'd', starts_at: new Date(2026, 9, 29, 19, 0).toISOString(), categories: ['music'] })
  const all = [kidsFree, kids, music, tomorrow]

  test('no filters returns everything', () => expect(filterEvents(all, null, new Set())).toHaveLength(4))
  test('types combine with AND', () => {
    expect(filterEvents(all, null, new Set(['kids', 'free'] as const)).map((e) => e.id)).toEqual(['a'])
    expect(filterEvents(all, null, new Set(['kids', 'music'] as const))).toHaveLength(0)
  })
  test('day filter', () => expect(filterEvents(all, dayKey(addDays(now, 1)), new Set()).map((e) => e.id)).toEqual(['d']))
  test('day + type', () => expect(filterEvents(all, dayKey(now), new Set(['21+'] as const)).map((e) => e.id)).toEqual(['c']))
})

describe('grouping and labels', () => {
  test('headers: Today, Tomorrow, weekday + date', () => {
    expect(dayHeader(dayKey(now), now)).toBe('Today')
    expect(dayHeader(dayKey(addDays(now, 1)), now)).toBe('Tomorrow')
    expect(dayHeader(dayKey(addDays(now, 3)), now)).toMatch(/Sat/)
  })
  test('sections sorted by start time', () => {
    const late = ev({ id: 'late', starts_at: new Date(2026, 9, 28, 21, 0).toISOString() })
    const early = ev({ id: 'early', starts_at: new Date(2026, 9, 28, 9, 0).toISOString() })
    const next = ev({ id: 'next', starts_at: new Date(2026, 9, 29, 9, 0).toISOString() })
    const s = groupByDay([next, late, early], now)
    expect(s.map((x) => x.title)).toEqual(['Today', 'Tomorrow'])
    expect(s[0].data.map((e) => e.id)).toEqual(['early', 'late'])
  })
  test('missing time and price are never filled in', () => {
    expect(timeLabel(ev({ all_day: true }))).toBe('See details')
    expect(noteLabel(ev({}))).toBe('Price: see details')
    expect(noteLabel(ev({ price_text: '$20', age_note: '21+' }))).toBe('21+ · $20')
    expect(noteLabel(ev({ is_free: true }))).toBeNull()
  })
})
