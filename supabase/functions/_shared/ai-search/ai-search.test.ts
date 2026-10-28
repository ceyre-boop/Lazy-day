import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createAiSearchAdapter, type AiMessage } from './adapter.ts'
import { parseAiJson, validateAiEvent } from './schema.ts'
import { costUsd, emptyUsage, addUsage, extractFetchedPages, normalizeUrl } from './pages.ts'
import { dateAppearsIn, timeAppearsIn } from './verify.ts'
import { runRules } from '../rules.ts'
import { runRegion } from '../run.ts'

// Fixtures follow the documented response shapes (server_tool_use, web_search_tool_result,
// web_fetch_tool_result, pause_turn). Replace with real recorded responses via `bun scripts/run-fetcher.ts --record`.
const fx = (name: string) => JSON.parse(readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8')) as AiMessage

const region = { lat: 42.3314, lng: -83.0458, radiusMiles: 30, label: 'Detroit, MI', timezone: 'America/Detroit' }
const from = new Date('2026-10-28T15:00:00Z')
const to = new Date(from.getTime() + 14 * 86_400_000)
const win = { now: from, end: to }

function runnerFrom(responses: AiMessage[]) {
  const calls: Record<string, unknown>[] = []
  let i = 0
  return {
    calls,
    run: async (p: Record<string, unknown>) => {
      calls.push(JSON.parse(JSON.stringify(p)))
      return responses[i++]
    },
  }
}
const geocode = async (addr: string) =>
  addr.includes('Beck Rd') ? { lat: 42.4, lng: -83.5 } : addr.includes('Five Mile') ? { lat: 42.39, lng: -83.37 } : null

async function runFixture() {
  const r = runnerFrom([fx('turn1-paused.json'), fx('turn2-final.json')])
  const adapter = createAiSearchAdapter({ run: r.run, geocode })
  const candidates = await adapter.fetch({ region, from, to, get: async () => '' })
  return { r, adapter, candidates, result: runRules(candidates, win, { region, fetchedAt: from }) }
}

describe('request shape and pause_turn', () => {
  test('uses the current tool versions, model, and resumes a paused turn without an extra user message', async () => {
    const { r } = await runFixture()
    expect(r.calls).toHaveLength(2)
    const first = r.calls[0] as { model: string; tools: { type: string }[] }
    expect(first.model).toBe('claude-sonnet-5-5')
    expect(first.tools.map((t) => t.type)).toEqual(['web_search_20260318', 'web_fetch_20260318'])
    const second = r.calls[1] as { messages: { role: string }[] }
    expect(second.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })
  test('usage and cost add across turns', async () => {
    const { adapter } = await runFixture()
    const rep = adapter.lastReport!
    expect(rep.turns).toBe(2)
    expect(rep.usage.web_search_requests).toBe(4)
    // (42000*2 + 3300*10 + 4000*0.2)/1e6 + 4*0.01
    expect(rep.costUsd).toBeCloseTo((42000 * 2 + 3300 * 10 + 4000 * 0.2) / 1e6 + 0.04, 6)
  })
  test('errors out rather than returning partial data on max_tokens or refusal', async () => {
    for (const stop of ['max_tokens', 'refusal']) {
      const msg = { ...fx('turn2-final.json'), stop_reason: stop }
      const a = createAiSearchAdapter({ run: runnerFrom([msg]).run, geocode })
      await expect(a.fetch({ region, from, to, get: async () => '' })).rejects.toThrow()
    }
  })
})

describe('fetched pages', () => {
  test('only successful web_fetch results count; search snippets and errors do not', () => {
    const blocks = [...fx('turn1-paused.json').content, ...fx('turn2-final.json').content]
    const pages = extractFetchedPages(blocks)
    expect([...pages.keys()].sort()).toEqual([
      'example.org/events/haunted-hayride'.replace(/^/, 'https://'),
      'https://example.org/events/library-craft',
    ].sort())
    expect(pages.has(normalizeUrl('https://example.org/events/snippet-only'))).toBe(false)
    expect(pages.has(normalizeUrl('https://example.org/events/blocked'))).toBe(false)
  })
  test('url normalization', () => {
    expect(normalizeUrl('https://WWW.Example.org/a/?utm_source=x#top')).toBe(normalizeUrl('https://example.org/a'))
  })
})

describe('JSON validation', () => {
  test('parses fenced JSON and rejects missing events', () => {
    expect(parseAiJson('```json\n{"events":[]}\n```').events).toEqual([])
    expect(() => parseAiJson('sorry, no events')).toThrow()
    expect(() => parseAiJson('{"items":[]}')).toThrow()
  })
  const good = {
    title: 'X', start_date: '2026-10-31', start_time: '19:00', end_date: null, end_time: null, venue: null, address: null,
    city: null, lat: null, lng: null, price_text: null, is_free: null, age_note: null, categories: ['music', 'bogus'],
    source_url: 'https://e.com/x', date_evidence: 'Oct 31', recurring: false,
  }
  test('accepts a valid item and drops unknown categories', () => {
    const v = validateAiEvent(good)
    expect(v.ok && v.event.categories).toEqual(['music'])
  })
  test.each([
    ['bad date', { start_date: '10/31/2026' }],
    ['bad time', { start_time: '7pm' }],
    ['no url', { source_url: 'ftp://x' }],
    ['no evidence', { date_evidence: '' }],
    ['recurring not boolean', { recurring: 'yes' }],
    ['lat string', { lat: '42' }],
  ])('rejects %s', (_n, patch) => {
    expect(validateAiEvent({ ...good, ...patch }).ok).toBe(false)
  })
})

describe('date and time matching', () => {
  test('written date forms', () => {
    for (const t of ['October 31, 2026', 'Oct. 31', '31 October', '10/31/2026', '2026-10-31', 'Oct 31st']) {
      expect(dateAppearsIn(t, '2026-10-31')).toBe(true)
    }
    expect(dateAppearsIn('October 3', '2026-10-31')).toBe(false)
    expect(dateAppearsIn('November 1', '2026-10-31')).toBe(false)
  })
  test('time forms', () => {
    expect(timeAppearsIn('starts at 7:00 PM', '19:00')).toBe(true)
    expect(timeAppearsIn('doors 7 pm', '19:00')).toBe(true)
    expect(timeAppearsIn('7:00 AM', '19:00')).toBe(false)
    expect(timeAppearsIn('19:30', '19:30')).toBe(true)
    expect(timeAppearsIn('7:30 pm', '19:00')).toBe(false)
  })
})

describe('drop rules on recorded responses', () => {
  test('keeps only events the fetched page backs up, logs every other with a reason', async () => {
    const { result } = await runFixture()
    expect(result.rows.map((r) => r.title).sort()).toEqual(['Haunted Hayride', 'Kids Craft Night'])
    const reasons = Object.fromEntries(result.dropped.map((d) => [d.title, d.reason]))
    expect(reasons['Snippet Only Event']).toBe('not_fetched')
    expect(reasons['Blocked Page Event']).toBe('not_fetched')
    expect(reasons['Wrong Date Concert']).toBe('date_not_on_page')
    expect(reasons['Weekly Yoga']).toBe('recurring_no_date')
    expect(reasons['(untitled)'] ?? reasons['Broken Item']).toBe('invalid_ai_output')
    expect(result.dropped).toHaveLength(5)
    for (const d of result.dropped) expect(d.detail.length).toBeGreaterThan(0)
  })
  test('time, price, age and free are kept only when the page states them', async () => {
    const { result } = await runFixture()
    const hay = result.rows.find((r) => r.title === 'Haunted Hayride')!
    expect(hay.price_text).toBe('$12')
    expect(hay.age_note).toBe('21+')
    expect(hay.categories).toContain('21+')
    expect(hay.all_day).toBe(false)
    const craft = result.rows.find((r) => r.title === 'Kids Craft Night')!
    // the page gives the date and "free" but no time: the model's 18:30 must not survive
    expect(craft.all_day).toBe(true)
    expect(craft.is_free).toBe(true)
    expect(craft.starts_at).toBe('2026-10-29T04:00:00.000Z')
  })
  test('window rule still applies to ai-search events', async () => {
    const late = runRules((await runFixture()).candidates, { now: new Date('2026-12-01T00:00:00Z'), end: new Date('2026-12-15T00:00:00Z') }, { region })
    expect(late.rows).toHaveLength(0)
    expect(late.dropped.filter((d) => d.reason === 'outside_window')).toHaveLength(2)
  })
  test('events without a locatable venue are dropped', async () => {
    const r = runnerFrom([fx('turn1-paused.json'), fx('turn2-final.json')])
    const a = createAiSearchAdapter({ run: r.run, geocode: async () => null })
    const c = await a.fetch({ region, from, to, get: async () => '' })
    expect(runRules(c, win, { fetchedAt: from }).dropped.some((d) => d.reason === 'no_location' && d.title === 'Kids Craft Night')).toBe(true)
  })
})

describe('pipeline wiring', () => {
  test('ticketmaster is off by default; ai-search runs when a runner is given', async () => {
    const r = runnerFrom([fx('turn1-paused.json'), fx('turn2-final.json')])
    const out = await runRegion(region, {
      aiRunner: r.run,
      aiGeocode: geocode,
      ticketmasterKey: 'KEY',
      adapters: [],
      now: from,
      fetchFn: (async () => { throw new Error('network must not be touched') }) as never,
    })
    expect(Object.keys(out.fetchedBySource)).toEqual(['ai-search'])
    expect(out.rows).toHaveLength(2)
    expect(out.aiSearch?.turns).toBe(2)
  })
  test('without an Anthropic runner ai-search is skipped with a note', async () => {
    const out = await runRegion(region, { adapters: [], now: from })
    expect(out.sourceErrors[0]).toContain('ANTHROPIC_API_KEY')
  })
  test('cost helper', () => {
    const u = emptyUsage()
    addUsage(u, { input_tokens: 1_000_000, output_tokens: 100_000, server_tool_use: { web_search_requests: 10 } })
    expect(costUsd(u)).toBeCloseTo(2 + 1 + 0.1, 6)
  })
})
