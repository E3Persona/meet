import "dotenv/config"
import { prisma } from "../lib/prisma"
import { scrapeSgmpEvents } from "../lib/scrapers/sgmp"
import { statesMatch } from "../lib/stateNormalize"


const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "sgmp" },
  })
  return {
    active: cfg?.active ?? true,
    maxMonths: cfg?.maxMonths ?? 12,
  }
}

function matchLocation(
  ev: { venueCity: string | null; venueState: string | null; venueName: string | null; eventName: string },
  locations: { id: string; name: string; city: string | null; state: string | null }[]
): { id: string } | null {
  const searchText = [ev.eventName, ev.venueName ?? "", ev.venueCity ?? "", ev.venueState ?? ""]
    .join(" ")
    .toLowerCase()

  const STATE_TO_CODE: Record<string, string> = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
    colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
    kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
    massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
    montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
    "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
    vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
    wisconsin: "WI", wyoming: "WY",
  }
  const CODE_TO_STATE = Object.fromEntries(
    Object.entries(STATE_TO_CODE).map(([k, v]) => [v.toLowerCase(), k])
  )

  for (const loc of locations) {
    const name = loc.name.toLowerCase()
    const city = loc.city?.toLowerCase()
    const state = loc.state?.toLowerCase()

    if (ev.venueCity && ev.venueState && city && state) {
      const cityMatch = ev.venueCity.toLowerCase().includes(city) || city.includes(ev.venueCity.toLowerCase())
      const stateMatch = statesMatch(ev.venueState, loc.state)
      if (cityMatch && stateMatch) return loc
    }
    if (city && state && searchText.includes(city) && searchText.includes(state)) return loc
    if (name && searchText.includes(name)) return loc
    if (city && searchText.includes(city)) return loc

    if (state) {
      const stateName = CODE_TO_STATE[state]
      if (stateName && searchText.includes(stateName)) return loc
    }
  }

  return null
}

async function main() {
  console.log(`[SGMP/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[SGMP/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[SGMP/Ingest] Scraping disabled via IngestConfig")
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
      where: { name: "sgmp.org" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[SGMP/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  // Build venue name lookup for venue matching
  const venueMap = new Map<string, typeof venues[number]>()
  for (const venue of venues) {
    const key = venue.name.toLowerCase()
    venueMap.set(key, venue)
  }

  const allEvents = await scrapeSgmpEvents({ maxMonths: config.maxMonths })
  console.log(`[SGMP/Ingest] ${allEvents.length} events scraped`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    const loc = matchLocation(ev, locations)
    if (!loc) continue

    if (dateFrom && ev.eventDateStart && new Date(ev.eventDateStart) < dateFrom) continue
    if (dateTo && ev.eventDateStart && new Date(ev.eventDateStart) > dateTo) continue

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.eventName, mode: "insensitive" },
      },
    })
    if (existing) continue

    let eventDateStart: Date | undefined
    let eventDateEnd: Date | undefined

    if (ev.eventDateStart) {
      const d = new Date(ev.eventDateStart)
      if (!isNaN(d.getTime())) eventDateStart = d
    }
    if (ev.eventDateEnd) {
      const d = new Date(ev.eventDateEnd)
      if (!isNaN(d.getTime())) eventDateEnd = d
    }

    // Match venue name if provided
    let venueId: string | null = null
    let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"
    if (ev.venueName) {
      const venueKey = ev.venueName.toLowerCase()
      const matchedVenue = venueMap.get(venueKey)
      if (matchedVenue) {
        venueId = matchedVenue.id
        matchType = "venue_matched"
      }
    }

    const hasContact = ev.contactName || ev.contactEmail

    const event = await prisma.event.create({
      data: {
        locationId: loc.id,
          venueId: venueId ?? undefined,
        matchType,
        eventName: ev.eventName,
        eventDateStart,
        eventDateEnd,
        sourceUrl: ev.sourceUrl,
        sourceSiteId,
        runId: runId ?? undefined,
        expectedAttendees: null,
        organizerName: ev.contactName ?? null,
        organizerEmail: ev.contactEmail ?? null,
        organizerPhone: ev.contactPhone ?? null,
        rawLocationText: ev.venueCity && ev.venueState ? `${ev.venueCity}, ${ev.venueState}` : null,
        rawVenueText: ev.venueName ?? null,
        metadata: ev.description ? { fullDescription: ev.description } : undefined,
      },
    })
    totalNew++

    if (hasContact) {
      await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: ev.contactName ?? "",
          email: ev.contactEmail,
          phone: ev.contactPhone,
          isPrimary: true,
          sourceUrl: ev.sourceUrl,
          confidence: "medium",
        },
      })
      console.log(`[SGMP/Ingest] Saved contact for "${ev.eventName}"`)
    }
  }

  console.log(`[SGMP/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[SGMP/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
