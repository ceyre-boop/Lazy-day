export interface Hints {
  likes: string[]
  avoids: string[]
}

const clean = (v: unknown, max: number): string[] => {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    const t = x.replace(/[^A-Za-z0-9 &'.-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (t.length >= 2 && !out.includes(t.toLowerCase())) out.push(t.toLowerCase())
    if (out.length >= max) break
  }
  return out
}

/** Anyone can call the function, so hints are untrusted: cap the count and length, keep plain words only. */
export function sanitizeHints(raw: unknown): Hints {
  const o = (typeof raw === 'object' && raw ? raw : {}) as Record<string, unknown>
  return { likes: clean(o.likes, 8), avoids: clean(o.avoids, 5) }
}
