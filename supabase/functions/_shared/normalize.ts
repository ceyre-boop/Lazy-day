import type { Candidate } from './types.ts'
import { utcToLocalDate } from './tz.ts'

const strip = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function normalizeTitle(title: string): string {
  return strip(title).replace(/^(the|a|an) /, '')
}

export function normalizeVenue(venue: string | null): string {
  return venue ? strip(venue).replace(/^(the) /, '') : ''
}

/** The local start date used for de-dupe: the listing's own claim, else derived from the instant. */
export function startDate(c: Candidate): string {
  if (c.dateClaims.length > 0) return c.dateClaims[0]
  return utcToLocalDate(c.startsAt!, c.timezone ?? 'UTC')
}

export function dedupeKey(c: Candidate): string {
  return [normalizeTitle(c.title), normalizeVenue(c.venue), startDate(c)].join('|')
}

export function cleanText(s: string | null | undefined): string | null {
  if (s == null) return null
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > 0 ? t : null
}

export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const SEASONAL = /\b(halloween|haunted|haunt|spooky|trick[- ]or[- ]treat|pumpkin|corn maze|christmas|holiday lights|santa|thanksgiving|turkey trot|easter|egg hunt|winter wonderland|fireworks)\b/i
const KIDS = /\b(kids?|children'?s?|family|toddler|storytime|story time|all ages)\b/i

export function seasonalFromText(text: string): boolean {
  return SEASONAL.test(text)
}
export function kidsFromText(text: string): boolean {
  return KIDS.test(text)
}
