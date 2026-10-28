/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return asUtc - Math.floor(instantMs / 1000) * 1000
}

/** Convert a wall-clock date (+ optional HH:MM[:SS]) in `timeZone` to a UTC ISO string. */
export function localToUtcIso(date: string, time: string | null, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const [hh = 0, mm = 0, ss = 0] = (time ?? '00:00:00').split(':').map(Number)
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss)
  let result = guess - tzOffsetMs(guess, timeZone)
  result = guess - tzOffsetMs(result, timeZone)
  return new Date(result).toISOString()
}

/** The YYYY-MM-DD local date of an instant in `timeZone`. */
export function utcToLocalDate(instant: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
  return parts
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
