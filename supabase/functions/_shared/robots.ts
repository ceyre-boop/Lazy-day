/** Minimal robots.txt check: is `path` allowed for `agent` (falls back to `*`)? */
export function robotsAllows(robotsTxt: string, agent: string, path: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = []
  let cur: (typeof groups)[number] | null = null
  let lastWasAgent = false
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const i = line.indexOf(':')
    if (i < 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const val = line.slice(i + 1).trim()
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] }
        groups.push(cur)
      }
      cur.agents.push(val.toLowerCase())
      lastWasAgent = true
    } else if ((key === 'allow' || key === 'disallow') && cur) {
      lastWasAgent = false
      if (val !== '') cur.rules.push({ allow: key === 'allow', path: val })
    } else {
      lastWasAgent = false
    }
  }
  const a = agent.toLowerCase()
  const group =
    groups.find((g) => g.agents.some((x) => x !== '*' && a.includes(x))) ?? groups.find((g) => g.agents.includes('*'))
  if (!group) return true
  let best: { allow: boolean; len: number } | null = null
  for (const r of group.rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'))
    if (re.test(path) && (!best || r.path.length > best.len || (r.path.length === best.len && r.allow))) {
      best = { allow: r.allow, len: r.path.length }
    }
  }
  return best ? best.allow : true
}

export class RobotsDisallowedError extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`)
  }
}

export const USER_AGENT = 'LazyDayBot/1.0 (+events aggregator; respects robots.txt)'

/** The only HTTP getter adapters receive: checks robots.txt (cached per origin) before every request. */
export function createPoliteGet(fetchFn: typeof fetch = fetch) {
  const cache = new Map<string, string | null>()
  return async function get(url: string): Promise<string> {
    const u = new URL(url)
    if (!cache.has(u.origin)) {
      try {
        const r = await fetchFn(`${u.origin}/robots.txt`, { headers: { 'user-agent': USER_AGENT } })
        cache.set(u.origin, r.ok ? await r.text() : null) // no robots.txt (404) means allowed
      } catch {
        cache.set(u.origin, null)
      }
    }
    const txt = cache.get(u.origin)
    if (txt && !robotsAllows(txt, USER_AGENT, u.pathname + u.search)) throw new RobotsDisallowedError(url)
    const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } })
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`)
    return await res.text()
  }
}
