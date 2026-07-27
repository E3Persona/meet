import "dotenv/config"
import { scrapeASAE } from "../lib/scrapers/asae"
import { prisma } from "../lib/prisma"

const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

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

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "asae" },
  })
  return {
    active: cfg?.active ?? true,
  }
}

function parseEventDate(month: string, day: string): Date | null {
  const m = MONTH_NAMES[month.toLowerCase().trim()]
  if (m === undefined) return null
  const d = parseInt(day, 10)
  if (isNaN(d)) return null
  const now = new Date()
  let year = now.getFullYear()
  const date = new Date(year, m, d)
  if (date.getTime() < now.getTime() - 86400000 * 30) {
    year++
  }
  return new Date(year, m, d)
}

function extractCitiesAndStates(
  locationText: string | null
): { city: string; state: string }[] {
  if (!locationText || locationText === "null" || locationText.toLowerCase() === "online" || locationText.toLowerCase() === "virtual") return []
  const results: { city: string; state: string }[] = []
  const parts = locationText.split("/").map((s) => s.trim())
  for (const part of parts) {
    // Try "City, ST" pattern
    const m = part.match(/([A-Za-z\s.]+),\s*([A-Z]{2})\b/)
    if (m) {
      results.push({ city: m[1].trim(), state: m[2] })
      continue
    }
    // Try just "City" (no state)
    const cityOnly = part.match(/^([A-Za-z\s.]+)$/)
    if (cityOnly && cityOnly[1].trim().length > 2) {
      results.push({ city: cityOnly[1].trim(), state: "" })
    }
  }
  return results
}

function matchLocation(
  locations: {
    id: string
    name: string
    city: string | null
    state: string | null
  }[],
  citiesStates: { city: string; state: string }[]
): { id: string } | null {
  // 1. Exact city + state match
  for (const cs of citiesStates) {
    const c = cs.city.toLowerCase().trim()
    const s = cs.state.toLowerCase().trim()
    if (!s) continue
    for (const loc of locations) {
      const lc = loc.city?.toLowerCase().trim()
      const ls = loc.state?.toLowerCase().trim()
      if (lc === c && ls === s) return loc
    }
  }

  // 2. City name matches location.city (handles "Washington" matching "Washington DC" etc.)
  for (const cs of citiesStates) {
    const c = cs.city.toLowerCase().trim()
    for (const loc of locations) {
      const lc = loc.city?.toLowerCase().trim() ?? ""
      if (lc && (lc.includes(c) || c.includes(lc))) {
        console.warn(`[ASAE/Ingest] City-substring match: "${cs.city}" → location.city="${loc.city}" (${loc.name})`)
        return loc
      }
    }
  }

  // 3. City name matches location.name substring
  for (const cs of citiesStates) {
    const c = cs.city.toLowerCase().trim()
    for (const loc of locations) {
      if (loc.name.toLowerCase().includes(c)) {
        console.warn(`[ASAE/Ingest] Name-substring match: "${cs.city}" → location="${loc.name}"`)
        return loc
      }
    }
  }

  // 4. State-only match (if only one location in that state, use it)
  for (const cs of citiesStates) {
    const s = cs.state.toLowerCase().trim()
    if (!s) continue
    const stateLocs = locations.filter((l) => l.state?.toLowerCase().trim() === s)
    if (stateLocs.length === 1) {
      console.warn(`[ASAE/Ingest] State-only match: "${cs.state}" → single location "${stateLocs[0].name}"`)
      return stateLocs[0]
    }
  }

  return null
}

async function main() {
  console.log(`[ASAE/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[ASAE/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[ASAE/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, venues, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { id: "asc" },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "asaecenter.org" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[ASAE/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  // Build venue name lookup for venue matching
  const venueMap = new Map<string, typeof venues[number]>()
  for (const venue of venues) {
    const key = venue.name.toLowerCase()
    venueMap.set(key, venue)
  }

  const allEvents = await scrapeASAE({
    skipContacts: false,
    maxContactLookups: 50,
  })
  console.log(`[ASAE/Ingest] ${allEvents.length} events scraped`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    let cityLoc: { id: string; city: string | null; state: string | null } | null = null

    const citiesStates = extractCitiesAndStates(ev.locationText)
    if (citiesStates.length > 0) {
      const matched = matchLocation(locations, citiesStates)
      if (matched) {
        cityLoc = matched as { id: string; city: string | null; state: string | null }
      }
    }

    // Fallback: try to match based on event name (e.g. "Washington DC" in the name)
    if (!cityLoc) {
      const nameLower = ev.eventName.toLowerCase()
      for (const l of locations) {
        const cityName = l.city?.toLowerCase() ?? ""
        const stateName = l.state?.toLowerCase() ?? ""
        if (cityName && nameLower.includes(cityName)) {
          console.warn(`[ASAE/Ingest] Name-match: "${ev.eventName}" → location="${l.name}" (city in event name)`)
          cityLoc = l
          break
        }
        if (stateName && nameLower.includes(`${l.city?.toLowerCase()}, ${stateName}`)) {
          console.warn(`[ASAE/Ingest] Name-match: "${ev.eventName}" → location="${l.name}"`)
          cityLoc = l
          break
        }
      }
    }

    if (!cityLoc) {
      console.log(
        `[ASAE/Ingest] Skipping "${ev.eventName}" — no matching location (locationText="${ev.locationText}")`
      )
      continue
    }

    const eventDateStart = parseEventDate(ev.eventMonth, ev.eventDay)

    if (dateFrom && eventDateStart && eventDateStart < dateFrom) continue
    if (dateTo && eventDateStart && eventDateStart > dateTo) continue

    // Match venue name if provided in location text (reuse citiesStates from above)
    let venueId: string | null = null
    let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"
    for (const cs of citiesStates) {
      const venueKey = cs.city.toLowerCase()
      const matchedVenue = venueMap.get(venueKey)
      if (matchedVenue) {
        venueId = matchedVenue.id
        matchType = "venue_matched"
        break
      }
    }

    // Dedup includes eventDateStart so a recurring annual event (same name,
    // same venue, different year) is treated as a new record rather than
    // silently skipped forever after its first sync.
    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.eventName, mode: "insensitive" },
      },
    })
    if (existing) continue

    const contact = ev.contact ?? null
    const hasContact =
      contact && (contact.organizerEmail || contact.organizerPhone)

    const event = await prisma.event.create({
      data: {
        locationId: cityLoc.id,
          venueId: venueId ?? undefined,
        matchType,
        eventName: ev.eventName,
        eventDateStart: eventDateStart ?? undefined,
        sourceUrl: ev.detailUrl,
        sourceSiteId,
        runId: runId ?? undefined,
        expectedAttendees: null,
        rawLocationText: ev.locationText,
        rawVenueText: citiesStates.length > 0 ? citiesStates[0].city : null,
        organizerEmail: contact?.organizerEmail ?? null,
        organizerPhone: contact?.organizerPhone ?? null,
      },
    })
    totalNew++

    if (hasContact) {
      await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: "",
          email: contact!.organizerEmail,
          phone: contact!.organizerPhone,
          isPrimary: true,
          sourceUrl: ev.detailUrl,
          confidence: "medium",
        },
      })
      console.log(`[ASAE/Ingest] Saved contact for "${ev.eventName}"`)
    }
  }

  console.log(`[ASAE/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[ASAE/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
