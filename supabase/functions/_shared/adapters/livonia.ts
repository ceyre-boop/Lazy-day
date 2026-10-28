import type { SourceAdapter } from './types.ts'
import { mapVEvent, parseVEvents } from './ical.ts'

/**
 * Example adapter: City of Livonia, MI official iCal feed (CivicPlus calendar module).
 * robots.txt for livonia.gov does not disallow /common/modules/iCalendar/.
 * To add a city: copy this file, change FEED/areaCenter/coverage, register it in adapters/index.ts.
 */
// The module returns an empty body without a catID, so list the calendar categories to pull.
const CATEGORY_IDS = [14, 22, 23, 24, 25, 26, 27]
const feed = (catID: number) => `https://www.livonia.gov/common/modules/iCalendar/iCalendar.aspx?catID=${catID}&feed=calendar`
const AREA_CENTER = { lat: 42.3684, lng: -83.3527 }

/** CivicPlus puts the event page URL at the end of DESCRIPTION, after any free text. */
export function livoniaLink(description: string | undefined): string | null {
  return description?.match(/https:\/\/www\.livonia\.gov\/calendar\.aspx\?EID=\d+/)?.[0] ?? null
}

export const livoniaAdapter: SourceAdapter = {
  name: 'livonia-gov',
  coverage: { ...AREA_CENTER, radiusMiles: 8 },
  async fetch({ get }) {
    const feeds = await Promise.all(CATEGORY_IDS.map((id) => get(feed(id))))
    return feeds.flatMap(parseVEvents).map((ev) =>
      mapVEvent(ev, {
        sourceName: 'livonia-gov',
        timezone: 'America/Detroit',
        areaCenter: AREA_CENTER,
        defaultCity: 'Livonia',
        linkFor: (e) => livoniaLink(e.props.DESCRIPTION?.value),
      }),
    )
  },
}
