import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Location from 'expo-location'

export interface Place {
  lat: number
  lng: number
  label: string
}

const PLACE_KEY = 'lazyday.place'
const RADIUS_KEY = 'lazyday.radius'

export async function loadPlace(): Promise<Place | null> {
  try {
    const raw = await AsyncStorage.getItem(PLACE_KEY)
    return raw ? (JSON.parse(raw) as Place) : null
  } catch {
    return null
  }
}
export const savePlace = (p: Place) => AsyncStorage.setItem(PLACE_KEY, JSON.stringify(p)).catch(() => {})
export const clearPlace = () => AsyncStorage.removeItem(PLACE_KEY).catch(() => {})

export async function loadRadius(fallback: number): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(RADIUS_KEY)
    return raw ? Number(raw) : fallback
  } catch {
    return fallback
  }
}
export const saveRadius = (r: number) => AsyncStorage.setItem(RADIUS_KEY, String(r)).catch(() => {})

/** Asks for permission; returns null if denied or unavailable. */
export async function getDevicePlace(): Promise<Place | null> {
  const { status } = await Location.requestForegroundPermissionsAsync()
  if (status !== 'granted') return null
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Near you' }
}

/** City name or 5-digit ZIP -> coordinates, via free key-less geocoders. */
export async function geocode(query: string): Promise<Place | null> {
  const q = query.trim()
  if (!q) return null
  if (/^\d{5}$/.test(q)) {
    const r = await fetch(`https://api.zippopotam.us/us/${q}`)
    if (!r.ok) return null
    const j = await r.json()
    const p = j.places?.[0]
    return p ? { lat: Number(p.latitude), lng: Number(p.longitude), label: `${p['place name']}, ${p['state abbreviation']}` } : null
  }
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.split(',')[0])}&count=1&language=en&format=json`)
  if (!r.ok) return null
  const j = await r.json()
  const p = j.results?.[0]
  return p ? { lat: p.latitude, lng: p.longitude, label: [p.name, p.admin1].filter(Boolean).join(', ') } : null
}
