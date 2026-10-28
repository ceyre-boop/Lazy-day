import type { AppEvent, EventType } from './types'

export function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

/** Today, Tomorrow, then "Sat, Nov 1". */
export function dayHeader(key: string, now: Date): string {
  if (key === dayKey(now)) return 'Today'
  if (key === dayKey(addDays(now, 1))) return 'Tomorrow'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Day chip labels: All days, then the next 7 days starting today. */
export function dayChips(now: Date): { key: string | null; label: string }[] {
  const chips: { key: string | null; label: string }[] = [{ key: null, label: 'All days' }]
  for (let i = 0; i < 7; i++) {
    const d = addDays(now, i)
    const key = dayKey(d)
    chips.push({ key, label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }) })
  }
  return chips
}

/** Day filter (null = all) plus type chips combined with AND logic. */
export function filterEvents(events: AppEvent[], day: string | null, types: Set<EventType>): AppEvent[] {
  return events.filter((e) => {
    if (day && dayKey(new Date(e.starts_at)) !== day) return false
    for (const t of types) {
      const has = t === 'free' ? e.is_free || e.categories.includes('free') : e.categories.includes(t)
      if (!has) return false
    }
    return true
  })
}

export interface DaySection {
  key: string
  title: string
  data: AppEvent[]
}

export function groupByDay(events: AppEvent[], now: Date): DaySection[] {
  const sorted = [...events].sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const sections: DaySection[] = []
  for (const e of sorted) {
    const key = dayKey(new Date(e.starts_at))
    let s = sections[sections.length - 1]
    if (!s || s.key !== key) {
      s = { key, title: dayHeader(key, now), data: [] }
      sections.push(s)
    }
    s.data.push(e)
  }
  return sections
}

/** Never fill in a missing time: date-only events say "See details". */
export function timeLabel(e: AppEvent): string {
  if (e.all_day) return 'See details'
  return new Date(e.starts_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function noteLabel(e: AppEvent): string | null {
  const parts = [e.age_note, e.is_free ? null : e.price_text].filter(Boolean)
  if (e.price_text == null && !e.is_free) parts.push('Price: see details')
  return parts.length ? parts.join(' · ') : null
}

export function updatedLabel(events: AppEvent[]): string {
  if (events.length === 0) return ''
  const newest = events.reduce((m, e) => (e.fetched_at > m ? e.fetched_at : m), events[0].fetched_at)
  const d = new Date(newest)
  return `Updated ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}
