/** US Census one-line address geocoder: free, no API key. Returns null when no match. */
export function censusGeocoder(fetchFn: typeof fetch = fetch) {
  return async (address: string): Promise<{ lat: number; lng: number } | null> => {
    const url =
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' +
      encodeURIComponent(address)
    try {
      const res = await fetchFn(url)
      if (!res.ok) return null
      const j = await res.json()
      const c = j?.result?.addressMatches?.[0]?.coordinates
      return c && Number.isFinite(c.x) && Number.isFinite(c.y) ? { lat: c.y, lng: c.x } : null
    } catch {
      return null
    }
  }
}
