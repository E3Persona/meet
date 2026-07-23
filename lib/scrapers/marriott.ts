import { createJinaProvider } from "../providers/scrape/jina"

const MARRIOTT_EVENT_BASE = "https://event.marriott.com"

// Pulled directly from the site's own "Filter by categories" panel —
// using these as the split point is far more reliable than guessing a
// generic " - " delimiter, since event names can contain " - " themselves.
const KNOWN_CATEGORIES = [
  "Arts & Theater",
  "Business",
  "Concerts & Music",
  "Festivals & Fairs",
  "Sports & Recreation",
  "Other",
]

export interface MarriottLocalEvent {
  eventId: string
  eventName: string
  category: string | null
  eventDateStart: Date | null
  eventDateEnd: Date | null
  city: string | null
  state: string | null
  detailUrl: string
  sourceUrl: string
  sourceSite: "event.marriott.com"
  propertySlug: string
}

function buildEventsUrl(propertySlug: string): string {
  return `${MARRIOTT_EVENT_BASE}/${propertySlug}/events`
}

function parseDateRange(text: string): {
  start: Date | null
  end: Date | null
} {
  const match = text.match(
    /([A-Za-z]{3} \d{1,2}, \d{4})\s*-\s*([A-Za-z]{3} \d{1,2}, \d{4})/
  )
  if (!match) return { start: null, end: null }
  const start = new Date(match[1])
  const end = new Date(match[2])
  return {
    start: Number.isNaN(start.getTime()) ? null : start,
    end: Number.isNaN(end.getTime()) ? null : end,
  }
}

function splitNameAndCategory(prefix: string): {
  name: string
  category: string | null
} {
  for (const cat of KNOWN_CATEGORIES) {
    const idx = prefix.indexOf(` - ${cat}`)
    if (idx !== -1) return { name: prefix.slice(0, idx).trim(), category: cat }
  }
  return { name: prefix.trim(), category: null }
}

function nameFromSlug(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

// Matches "[<flattened card text>](https://event.marriott.com/<property>/events/<city-slug>/<event-slug>-<id>)"
const EVENT_LINK_RE =
  /\[([\s\S]*?)\]\((https:\/\/event\.marriott\.com\/[a-z0-9-]+\/events\/([a-z0-9-]+)\/([a-z0-9-]+)-(\d+))\)/g

export async function scrapeMarriottLocalEvents(
  propertySlug: string
): Promise<MarriottLocalEvent[]> {
  const eventsUrl = buildEventsUrl(propertySlug)
  const jina = createJinaProvider()
  const result = await jina.scrape(eventsUrl, { timeout: 30000 })
  if (!result.markdown) throw new Error(`Jina scrape failed: ${result.error ?? "no markdown returned"}`)
  const html = result.markdown

  const events: MarriottLocalEvent[] = []
  const seen = new Set<string>()

  for (const match of html.matchAll(EVENT_LINK_RE)) {
    const [, linkText, detailUrl, citySlug, eventSlug, eventId] = match
    if (seen.has(eventId)) continue

    const { start: eventDateStart, end: eventDateEnd } =
      parseDateRange(linkText)
    // Nav/footer chrome can incidentally match the URL shape without a
    // date attached — only keep blocks that actually carry a real date.
    if (!eventDateStart) continue
    seen.add(eventId)

    const firstSegment = linkText.split(/[A-Za-z]{3} \d{1,2}, \d{4}/)[0]
    const { name: rawName, category } = splitNameAndCategory(firstSegment)
    const eventName = rawName || nameFromSlug(eventSlug)

    // City/state reliably show up as the LAST " - City, State" pair in the
    // block — the one anchor point that survives regardless of how messy
    // the street-address portion ahead of it is.
    const cityStateMatch = linkText.match(/-\s*([^,\]]+),\s*([^,\]]+)\s*$/)
    const city = cityStateMatch
      ? cityStateMatch[1].trim()
      : nameFromSlug(citySlug)
    const state = cityStateMatch ? cityStateMatch[2].trim() : null

    events.push({
      eventId,
      eventName,
      category,
      eventDateStart,
      eventDateEnd,
      city,
      state,
      detailUrl,
      sourceUrl: eventsUrl,
      sourceSite: "event.marriott.com",
      propertySlug,
    })
  }

  console.log(`[marriott:${propertySlug}] ${events.length} events parsed`)
  return events
}

// Usage for Bethesda specifically:
// const bethesdaEvents = await scrapeMarriottLocalEvents("wasbt-bethesda-marriott")
