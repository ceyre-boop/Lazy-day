import type { SourceAdapter } from './types.ts'
import { mapVEvent, parseVEvents } from './ical.ts'

// City of Westland, MI: same CivicPlus iCal module as Livonia. robots.txt does not disallow /common/modules/iCalendar/.
const CATEGORY_IDS = [14, 26, 27, 30, 32, 35, 39]
const feed = (catID: number) => `https://www.cityofwestland.com/common/modules/iCalendar/iCalendar.aspx?catID=${catID}&feed=calendar`
const AREA_CENTER = { lat: 42.3242, lng: -83.4002 }

export const westlandAdapter: SourceAdapter = {
  name: 'westland-gov',
  coverage: { ...AREA_CENTER, radiusMiles: 8 },
  async fetch({ get }) {
    const feeds = await Promise.all(CATEGORY_IDS.map((id) => get(feed(id))))
    return feeds.flatMap(parseVEvents).map((ev) =>
      mapVEvent(ev, {
        sourceName: 'westland-gov',
        timezone: 'America/Detroit',
        areaCenter: AREA_CENTER,
        defaultCity: 'Westland',
        linkFor: (e) => e.props.DESCRIPTION?.value?.match(/https:\/\/www\.cityofwestland\.com\/calendar\.aspx\?EID=\d+/)?.[0] ?? null,
      }),
    )
  },
}
