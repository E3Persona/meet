const EVENTBRITE_BASE = "https://www.eventbrite.com"

export interface EventbriteEvent {
  eventId: string
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  venueName: string
  venueCity: string | null
  venueState: string | null
  venueAddress: string | null
  category: string | null
  format: string | null
  detailUrl: string
  sourceUrl: string
}

interface RawEvent {
  id: string
  name: string
  url: string
  start_date: string
  start_time: string
  end_date: string
  end_time: string
  is_online_event: boolean
  is_livestream: boolean
  primary_venue: {
    name: string
    address: {
      city: string
      region: string
      localized_address_display: string
    }
  }
  category?: { name: string }
  format?: { name: string }
}

function buildSearchUrl(q: string): string {
  return `${EVENTBRITE_BASE}/d/united-states/events/?q=${encodeURIComponent(q)}`
}

function normalize(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

function venueMatches(dbName: string, eventVenueName: string): boolean {
  const a = normalize(dbName)
  const b = normalize(eventVenueName)
  return a.includes(b) || b.includes(a)
}

function extractEventsFromPage(): { results: RawEvent[] } | null {
  const w = window as any
  const events = w.__SERVER_DATA__?.search_data?.events
  if (!events?.results) return null
  return { results: events.results }
}

export async function scrapeSearchPage(
  query: string,
  page: any,
): Promise<RawEvent[]> {
  const searchUrl = buildSearchUrl(query)
  await page.goto(searchUrl, {
    waitUntil: "networkidle2",
    timeout: 30000,
  })
  await new Promise((r) => setTimeout(r, 2000))

  const raw = await page.evaluate(extractEventsFromPage)
  if (!raw) {
    console.log(`[eventbrite] No search data for "${query}"`)
    return []
  }
  return raw.results
}

export function matchEventsToVenue(
  rawEvents: RawEvent[],
  venueName: string,
  venueCity: string,
  venueState: string,
): EventbriteEvent[] {
  const matched: EventbriteEvent[] = []
  const seen = new Set<string>()

  for (const r of rawEvents) {
    if (seen.has(r.id)) continue
    seen.add(r.id)

    if (r.is_online_event || r.is_livestream) continue

    const v = r.primary_venue
    if (!v?.name) continue

    const eventVenueName = v.name.trim()
    if (!venueMatches(venueName, eventVenueName)) continue

    const addr = v.address
    const eventCity = addr?.city?.trim() || null
    const eventState = addr?.region?.trim() || null

    if (eventCity && venueCity && normalize(eventCity) !== normalize(venueCity)) continue
    if (eventState && venueState && normalize(eventState) !== normalize(venueState)) continue

    const startDate = r.start_date || null
    const startTime = r.start_time || null
    const endDate = r.end_date || null
    const endTime = r.end_time || null

    matched.push({
      eventId: String(r.id),
      eventName: r.name || "",
      eventDateStart: startDate && startTime ? `${startDate}T${startTime}` : startDate,
      eventDateEnd: endDate && endTime ? `${endDate}T${endTime}` : endDate,
      venueName: eventVenueName,
      venueCity: eventCity,
      venueState: eventState,
      venueAddress: addr?.localized_address_display || null,
      category: r.category?.name || null,
      format: r.format?.name || null,
      detailUrl: r.url || "",
      sourceUrl: buildSearchUrl(`${venueName} ${venueCity}`),
    })
  }

  return matched
}

export async function scrapeAllEventsForCity(
  city: string,
  state: string,
  venues: Array<{ id: string; name: string }>,
  browser: any,
): Promise<Map<string, EventbriteEvent[]>> {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })

  const query = `${city} ${state} events`
  const rawEvents = await scrapeSearchPage(query, page)
  await page.close().catch(() => {})

  console.log(`[eventbrite] ${city}, ${state}: ${rawEvents.length} total events found`)

  const result = new Map<string, EventbriteEvent[]>()
  for (const v of venues) {
    const matched = matchEventsToVenue(rawEvents, v.name, city, state)
    if (matched.length > 0) {
      result.set(v.id, matched)
      console.log(`[eventbrite]   → "${v.name}": ${matched.length} events`)
    }
  }

  return result
}

export async function createEventbriteBrowser() {
  const puppeteerExtra = (await import("puppeteer-extra")).default
  const stealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default
  puppeteerExtra.use(stealthPlugin())

  return await puppeteerExtra.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })
}
