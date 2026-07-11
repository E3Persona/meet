import * as cheerio from "cheerio"

const BASE = "https://infosec-conferences.com"
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export interface InfosecEvent {
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  sourceUrl: string
  officialWebsite: string | null
  city: string
  state: string
  organizerName: string | null
  expectedAttendees: number | null
  eventType: string | null
  focus: string | null
  sourceSite: "infosec-conferences.com"
}

// Maps a DB Location's city+state to the infosec state slug.
// e.g. Philadelphia, PA -> pennsylvania
const STATE_SLUGS: Record<string, string> = {
  PA: "pennsylvania",
  DC: "district-of-columbia",
  MD: "maryland",
  NJ: "new-jersey",
  DE: "delaware",
  NY: "new-york",
  CA: "california",
  TX: "texas",
  FL: "florida",
  IL: "illinois",
  NV: "nevada",
  AZ: "arizona",
  CO: "colorado",
  WA: "washington",
  OR: "oregon",
  MA: "massachusetts",
  GA: "georgia",
  VA: "virginia",
  NC: "north-carolina",
  OH: "ohio",
  MI: "michigan",
  MN: "minnesota",
  TN: "tennessee",
  IN: "indiana",
  MO: "missouri",
  WI: "wisconsin",
  CT: "connecticut",
  LA: "louisiana",
  UT: "utah",
  AL: "alabama",
  SC: "south-carolina",
  KY: "kentucky",
  OK: "oklahoma",
  IA: "iowa",
  KS: "kansas",
  AR: "arkansas",
  MS: "mississippi",
  NE: "nebraska",
  NM: "new-mexico",
  HI: "hawaii",
  ID: "idaho",
  ME: "maine",
  MT: "montana",
  NH: "new-hampshire",
  RI: "rhode-island",
  SD: "south-dakota",
  VT: "vermont",
  WV: "west-virginia",
  WY: "wyoming",
  AK: "alaska",
  ND: "north-dakota",
}

function stateToSlug(stateAbbr: string): string | null {
  const s = stateAbbr.toUpperCase()
  return STATE_SLUGS[s] ?? null
}

// Normalize a city name for matching (lowercase, collapse whitespace)
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

// Maps a slug from the infosec state page URL to a DB state code
// Used for constructing the state listing URL.
function getStateSlug(stateCode: string): string | null {
  return stateToSlug(stateCode)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export interface DetailData {
  officialWebsite: string | null
  organizerName: string | null
  eventType: string | null
  focus: string | null
}

export interface ScrapeOptions {
  // Array of { cityName: string, stateCode: string } — only fetch states
  // containing these cities, then filter events to matching cities.
  targetLocations: { cityName: string; stateCode: string }[]
  maxPages?: number
  // Whether to fetch individual event detail pages for officialWebsite and cleaner organizer name
  fetchDetails?: boolean
}

/**
 * Scrapes infosec-conferences.com for events.
 *
 * Step 1: For each state that has at least one target city, fetch the state
 *         listing page at /us-state/{slug}/.
 * Step 2: Parse event cards, filter by city name, extract structured data
 *         including expected attendee size (from the event-card__meta Size field).
 * Step 3: Optionally fetch individual detail pages for officialWebsite and cleaner data.
 */
export async function scrapeInfosecConferences(
  options: ScrapeOptions
): Promise<InfosecEvent[]> {
  const { targetLocations, fetchDetails } = options
  const shouldFetchDetails = fetchDetails ?? true

  // Group target locations by state so we know which state pages to fetch
  const stateToCities = new Map<string, { cityName: string; stateCode: string }[]>()
  for (const loc of targetLocations) {
    const slug = getStateSlug(loc.stateCode)
    if (!slug) {
      console.warn(`[Infosec] No slug for state "${loc.stateCode}" — skipping "${loc.cityName}"`)
      continue
    }
    if (!stateToCities.has(slug)) stateToCities.set(slug, [])
    stateToCities.get(slug)!.push(loc)
  }

  if (stateToCities.size === 0) {
    console.log("[Infosec] No mappable state slugs for target locations")
    return []
  }

  // Normalized set of target cities for fast filtering (used per-state)
  const targetCityNormSet = new Set(
    targetLocations.map((l) => norm(l.cityName))
  )

  const results: InfosecEvent[] = []

  for (const [stateSlug, cities] of stateToCities) {
    const stateCode = cities[0].stateCode
    const stateUrl = `${BASE}/us-state/${stateSlug}/`

    console.log(
      `[Infosec] Fetching state page for "${stateSlug}" (${cities.length} target cities): ${stateUrl}`
    )

    const page = await fetchPage(stateUrl)
    if (!page) {
      console.warn(`[Infosec] Failed to fetch state page: ${stateUrl}`)
      continue
    }

    const events = parseEventCards(page, stateCode, targetCityNormSet)
    console.log(
      `[Infosec] Found ${events.length} events matching target cities on ${stateSlug} page`
    )

    // Optionally fetch detail pages for richer data
    if (shouldFetchDetails && events.length > 0) {
      for (let i = 0; i < events.length; i++) {
        const ev = events[i]
        console.log(`[Infosec] Detail: ${ev.eventName} — ${ev.sourceUrl}`)
        try {
          const detail = await fetchDetailPage(ev.sourceUrl)
          if (detail) {
            ev.officialWebsite = detail.officialWebsite ?? ev.officialWebsite
            ev.organizerName = detail.organizerName ?? ev.organizerName
            ev.eventType = detail.eventType ?? ev.eventType
            ev.focus = detail.focus ?? ev.focus
          }
        } catch (err) {
          console.warn(`[Infosec] Detail failed for ${ev.sourceUrl}:`, err)
        }
        // Polite delay between detail page fetches
        if (i < events.length - 1) await wait(1500 + Math.random() * 1000)
      }
    }

    results.push(...events)
  }

  results.sort((a, b) => {
    const at = a.eventDateStart ? new Date(a.eventDateStart).getTime() : 0
    const bt = b.eventDateStart ? new Date(b.eventDateStart).getTime() : 0
    return at - bt
  })

  return results
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.warn(`[Infosec] HTTP ${res.status} for ${url}`)
      return null
    }
    return await res.text()
  } catch (err) {
    console.error(`[Infosec] Fetch failed for ${url}:`, err)
    return null
  }
}

const SIZE_MAP: Record<string, number> = {
  "< 50": 25,
  "51 - 100": 75,
  "101 - 300": 200,
  "301 - 500": 400,
  "500+": 500,
}

function parseSizeValue(text: string): number | null {
  const trimmed = text.trim()
  if (SIZE_MAP[trimmed] !== undefined) return SIZE_MAP[trimmed]
  // Try to parse a plain number
  const match = trimmed.match(/(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

/**
 * Parse event cards from a state listing page HTML.
 */
function parseEventCards(
  html: string,
  stateCode: string,
  targetCityNormSet: Set<string>
): InfosecEvent[] {
  const $ = cheerio.load(html)
  const events: InfosecEvent[] = []

  // Each event is an <article class="event-card">
  $('article.event-card').each((_, article) => {
    const $article = $(article)

    // ── Event name ──
    const nameEl = $article.find('.event-card__title a').first()
    const eventName = nameEl.text().trim()
    const sourceUrl = nameEl.attr('href') || ''
    if (!eventName || !sourceUrl) return

    // ── Organizer ──
    const orgText = $article.find('.event-card__org').first().text().trim()
    // Organizer text format: "Organizer Name · Topic" or just "Organizer Name"
    const organizerName = orgText ? orgText.split('·')[0].trim() : null

    // ── Meta fields ──
    const metaItems: Record<string, string> = {}
    $article.find('.event-meta-item').each((_, item) => {
      const $item = $(item)
      const label = $item.find('.event-meta-item__label').text().trim().toUpperCase()
      const value = $item.find('.event-meta-item__value').text().trim()
      if (label && value) metaItems[label] = value
    })

    const city = metaItems['CITY'] || ''
    const state = metaItems['US STATE'] || stateCode
    const country = metaItems['COUNTRY'] || ''
    const dateText = metaItems['EVENT DATE'] || ''
    const sizeText = metaItems['SIZE'] || ''

    // Filter by city: only keep events whose city is in our target set
    if (!targetCityNormSet.has(norm(city))) return

    // Only US events
    if (country && !country.toLowerCase().includes('united states') && country !== 'US') return
    if (country.toLowerCase().includes('canada')) return

    // ── Expected attendees ──
    const expectedAttendees = sizeText ? parseSizeValue(sizeText) : null

    // ── Dates ──
    // Date format: "3 August 2026"
    let eventDateStart: string | null = null
    let eventDateEnd: string | null = null
    if (dateText) {
      // Check for date range like "3 August - 5 August 2026" or single date
      const rangeMatch = dateText.match(
        /(\d+\s+[A-Z][a-z]+\s+\d{4})\s*[-–]\s*(\d+\s+[A-Z][a-z]+\s+\d{4})/
      )
      if (rangeMatch) {
        eventDateStart = parseDate(rangeMatch[1])
        eventDateEnd = parseDate(rangeMatch[2])
      } else {
        // Check for range like "3 - 5 August 2026"
        const rangeMatch2 = dateText.match(
          /(\d+)\s*[-–]\s*(\d+\s+[A-Z][a-z]+\s+\d{4})/
        )
        if (rangeMatch2) {
          const dayFrom = rangeMatch2[1]
          const rest = rangeMatch2[2]
          // rest = "5 August 2026" -> replace day
          const restParts = rest.match(/(\d+)\s+([A-Z][a-z]+\s+\d{4})/)
          if (restParts) {
            eventDateStart = parseDate(`${dayFrom} ${restParts[2]}`)
            eventDateEnd = parseDate(rest)
          }
        } else {
          eventDateStart = parseDate(dateText)
        }
      }
    }

    events.push({
      eventName,
      eventDateStart,
      eventDateEnd,
      sourceUrl,
      officialWebsite: sourceUrl, // Will be overwritten by detail page if fetched
      city,
      state,
      organizerName,
      expectedAttendees,
      eventType: null,
      focus: null,
      sourceSite: "infosec-conferences.com",
    })
  })

  return events
}

/**
 * Fetch an individual event detail page for richer data
 * (official website link, focus/topic, event type).
 *
 * Does NOT extract organizer contacts (email/phone) — those are manual-only.
 */
async function fetchDetailPage(url: string): Promise<DetailData | null> {
  const html = await fetchPage(url)
  if (!html) return null

  const $ = cheerio.load(html)

  // ── Official website: the "Visit Event" CTA link in the sidebar ──
  let officialWebsite: string | null = null
  const ctaLink = $('a.ev-meta__cta').first()
  if (ctaLink.length) {
    const href = ctaLink.attr('href')
    if (href && !href.includes('infosec-conferences.com')) {
      officialWebsite = href
    }
  }

  // ── Organizer name from the ev-meta__fields (more structured than listing page) ──
  let organizerName: string | null = null
  const orgField = $('.ev-meta__field').filter((_, el) => {
    return $(el).find('.ev-meta__label').text().trim().toLowerCase() === 'organization'
  }).first()
  if (orgField.length) {
    organizerName = orgField.find('.ev-meta__value').text().trim() || null
  }

  // ── Event type from ev-meta__fields ──
  let eventType: string | null = null
  const typeField = $('.ev-meta__field').filter((_, el) => {
    return $(el).find('.ev-meta__label').text().trim().toLowerCase() === 'type'
  }).first()
  if (typeField.length) {
    eventType = typeField.find('.ev-meta__value').text().trim() || null
  }

  // ── Focus from ev-meta__fields ──
  let focus: string | null = null
  const focusField = $('.ev-meta__field').filter((_, el) => {
    return $(el).find('.ev-meta__label').text().trim().toLowerCase() === 'focus'
  }).first()
  if (focusField.length) {
    focus = focusField.find('.ev-meta__value').text().trim() || null
  }

  return { officialWebsite, organizerName, eventType, focus }
}

const MONTH_NAMES: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
}

function parseDate(dateStr: string): string | null {
  // Accept formats: "3 August 2026", "August 3, 2026"
  const trimmed = dateStr.trim()

  // Try "3 August 2026"
  const match1 = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (match1) {
    const day = parseInt(match1[1], 10)
    const monthName = match1[2].toLowerCase()
    const year = parseInt(match1[3], 10)
    const month = MONTH_NAMES[monthName]
    if (month !== undefined) {
      return new Date(Date.UTC(year, month, day)).toISOString()
    }
  }

  // Try "August 3, 2026"
  const match2 = trimmed.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/)
  if (match2) {
    const monthName = match2[1].toLowerCase()
    const day = parseInt(match2[2], 10)
    const year = parseInt(match2[3], 10)
    const month = MONTH_NAMES[monthName]
    if (month !== undefined) {
      return new Date(Date.UTC(year, month, day)).toISOString()
    }
  }

  return null
}
