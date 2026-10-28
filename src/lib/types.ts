export type EventType = 'kids' | 'free' | 'music' | 'sports' | 'shows' | 'seasonal' | '21+'

export interface AppEvent {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  venue: string | null
  address: string | null
  city: string | null
  lat: number | null
  lng: number | null
  price_text: string | null
  is_free: boolean
  categories: string[]
  age_note: string | null
  source_name: string
  source_url: string
  fetched_at: string
}

export const TYPE_CHIPS: { key: EventType; label: string }[] = [
  { key: 'kids', label: 'Kids' },
  { key: 'free', label: 'Free' },
  { key: 'music', label: 'Music' },
  { key: 'sports', label: 'Sports' },
  { key: 'shows', label: 'Shows' },
  { key: 'seasonal', label: 'Haunted/Seasonal' },
  { key: '21+', label: '21+' },
]

export const RADIUS_OPTIONS = [5, 15, 30, 50] as const
export const DEFAULT_RADIUS = 15
