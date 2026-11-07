import AsyncStorage from '@react-native-async-storage/async-storage'
import type { AppEvent } from './types'

/** What the app has learned about this device's owner. Stays on the device: no accounts, no server, no AI cost. */
export interface Taste {
  weights: Record<string, number> // "cat:music", "venue:michigan stadium", "word:football" -> affinity
  liked: Record<string, AppEvent> // saved events, by id (kept so they survive the source dropping them)
  dismissed: string[] // event ids hidden with "Not for me"
}

export const emptyTaste = (): Taste => ({ weights: {}, liked: {}, dismissed: [] })

const STOP = new Set(['the', 'and', 'with', 'for', 'live', 'tour', 'presents', 'tickets', 'night', 'event', 'show', 'from', 'your'])

/** The things about an event we learn from: its categories, its venue, and the distinctive words in its title. */
export function features(e: AppEvent): string[] {
  const out = e.categories.filter((c) => c !== '21+').map((c) => `cat:${c}`)
  if (e.is_free) out.push('cat:free')
  if (e.venue) out.push(`venue:${e.venue.toLowerCase()}`)
  for (const w of new Set(e.title.toLowerCase().match(/[a-z]{4,}/g) ?? [])) if (!STOP.has(w)) out.push(`word:${w}`)
  return out
}

const bump = (t: Taste, e: AppEvent, by: number): Taste => {
  const weights = { ...t.weights }
  for (const f of features(e)) weights[f] = (weights[f] ?? 0) + by
  return { ...t, weights }
}

export const like = (t: Taste, e: AppEvent): Taste =>
  t.liked[e.id] ? t : { ...bump(t, e, 1), liked: { ...t.liked, [e.id]: e } }

export const unlike = (t: Taste, e: AppEvent): Taste => {
  if (!t.liked[e.id]) return t
  const { [e.id]: _, ...liked } = t.liked
  return { ...bump(t, e, -1), liked }
}

export const dismiss = (t: Taste, e: AppEvent): Taste =>
  t.dismissed.includes(e.id) ? t : { ...bump(t, e, -0.5), dismissed: [...t.dismissed, e.id] }

/** A small nudge for opening an event's details page: a weaker signal than a like. */
export const opened = (t: Taste, e: AppEvent): Taste => bump(t, e, 0.25)

export function score(t: Taste, e: AppEvent): number {
  let s = 0
  for (const f of features(e)) {
    const w = t.weights[f] ?? 0
    // Words and venues are specific, so they count for more than a broad category.
    s += f.startsWith('cat:') ? w : w * 1.5
  }
  return s
}

/** Best matches first, only ones that score above zero, never anything already saved or dismissed. */
export function pickedForYou(t: Taste, events: AppEvent[], limit = 5): AppEvent[] {
  return events
    .filter((e) => !t.liked[e.id] && !t.dismissed.includes(e.id))
    .map((e) => ({ e, s: score(t, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.e.starts_at.localeCompare(b.e.starts_at))
    .slice(0, limit)
    .map((x) => x.e)
}

const KEY = 'lazyday.taste.v1'
export async function loadTaste(): Promise<Taste> {
  try {
    const raw = await AsyncStorage.getItem(KEY)
    return raw ? { ...emptyTaste(), ...JSON.parse(raw) } : emptyTaste()
  } catch {
    return emptyTaste()
  }
}
export const saveTaste = (t: Taste) => AsyncStorage.setItem(KEY, JSON.stringify(t)).catch(() => {})
