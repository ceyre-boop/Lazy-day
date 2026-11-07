import { describe, expect, test } from 'bun:test'
import { dismiss, emptyTaste, like, pickedForYou, score, unlike } from './taste'
import type { AppEvent } from './types'

const ev = (o: Partial<AppEvent>): AppEvent => ({
  id: 'x', title: 't', starts_at: '2026-11-08T19:00:00Z', ends_at: null, all_day: false, venue: null, address: null,
  city: null, lat: null, lng: null, price_text: null, is_free: false, categories: [], age_note: null,
  source_name: 's', source_url: 'https://e', fetched_at: '2026-11-07T10:00:00Z', ...o,
})
const game = ev({ id: 'g1', title: 'Michigan vs Michigan State Football', venue: 'Michigan Stadium', categories: ['sports'] })

describe('taste', () => {
  test('liking a game raises similar events above unrelated ones', () => {
    const t = like(emptyTaste(), game)
    const similar = ev({ id: 'g2', title: 'Michigan Wolverines Football Spring Game', venue: 'Michigan Stadium', categories: ['sports'] })
    const other = ev({ id: 'm1', title: 'Jazz Night', categories: ['music'] })
    expect(score(t, similar)).toBeGreaterThan(score(t, other))
    expect(pickedForYou(t, [other, similar]).map((e) => e.id)).toEqual(['g2'])
  })
  test('a saved or dismissed event is never recommended again', () => {
    const t = dismiss(like(emptyTaste(), game), ev({ id: 'd1', title: 'Football Clinic', categories: ['sports'] }))
    expect(pickedForYou(t, [game, ev({ id: 'd1', title: 'Football Clinic', categories: ['sports'] })])).toEqual([])
  })
  test('unlike undoes the learning', () => {
    const t = unlike(like(emptyTaste(), game), game)
    expect(score(t, game)).toBe(0)
    expect(t.liked).toEqual({})
  })
  test('nothing is recommended before anything is learned', () => expect(pickedForYou(emptyTaste(), [game])).toEqual([]))
  test('dismissing teaches what to avoid', () => {
    const t = dismiss(emptyTaste(), ev({ id: 'k1', title: 'Toddler Story Time', categories: ['kids'] }))
    expect(score(t, ev({ id: 'k2', title: 'Kids Craft', categories: ['kids'] }))).toBeLessThan(0)
  })
})
