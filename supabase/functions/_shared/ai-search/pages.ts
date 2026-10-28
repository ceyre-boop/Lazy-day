// deno-lint-ignore no-explicit-any
type Block = any

export interface FetchedPage {
  url: string
  /** Page text as returned by web fetch; null for PDFs/binary (cannot be checked in code). */
  text: string | null
}

/** Canonical form for comparing URLs: lowercase host, no hash, no tracking params, no trailing slash. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k)
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '')
    return (u.origin + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}

/**
 * Pages Claude actually fetched, from `web_fetch_tool_result` blocks. Error results and URLs that only
 * showed up in `web_search_tool_result` snippets are not included.
 */
export function extractFetchedPages(content: Block[]): Map<string, FetchedPage> {
  const requested = new Map<string, string>() // tool_use_id -> requested url
  for (const b of content) {
    if (b?.type === 'server_tool_use' && b.name === 'web_fetch' && b.input?.url) requested.set(b.id, b.input.url)
  }
  const pages = new Map<string, FetchedPage>()
  for (const b of content) {
    if (b?.type !== 'web_fetch_tool_result') continue
    const r = b.content
    if (!r || r.type !== 'web_fetch_result') continue // web_fetch_tool_result_error
    const src = r.content?.source
    const text = src?.type === 'text' && typeof src.data === 'string' ? src.data : null
    const url: string = r.url ?? requested.get(b.tool_use_id) ?? ''
    if (!url) continue
    const page = { url, text }
    pages.set(normalizeUrl(url), page)
    const asked = requested.get(b.tool_use_id)
    if (asked) pages.set(normalizeUrl(asked), page) // a redirect may change the final URL
  }
  return pages
}

/** All text blocks of the final assistant turn, joined. */
export function finalText(content: Block[]): string {
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  web_search_requests: number
  web_fetch_requests: number
}

export const emptyUsage = (): Usage => ({
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  web_search_requests: 0,
  web_fetch_requests: 0,
})

export function addUsage(into: Usage, u: Block): void {
  into.input_tokens += u?.input_tokens ?? 0
  into.output_tokens += u?.output_tokens ?? 0
  into.cache_creation_input_tokens += u?.cache_creation_input_tokens ?? 0
  into.cache_read_input_tokens += u?.cache_read_input_tokens ?? 0
  into.web_search_requests += u?.server_tool_use?.web_search_requests ?? 0
  into.web_fetch_requests += u?.server_tool_use?.web_fetch_requests ?? 0
}

/** claude-sonnet-5-5 list prices (USD per million tokens) and web search ($10 per 1,000). Web fetch is not metered. */
export const PRICING = { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2, perSearch: 0.01 }

export function costUsd(u: Usage): number {
  return (
    (u.input_tokens * PRICING.input +
      u.output_tokens * PRICING.output +
      u.cache_creation_input_tokens * PRICING.cacheWrite5m +
      u.cache_read_input_tokens * PRICING.cacheRead) /
      1e6 +
    u.web_search_requests * PRICING.perSearch
  )
}
