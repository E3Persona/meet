import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeBMEvents, scrapeBMVenues } from "../lib/scrapers/blackmeetings"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true"

function debug(...args: unknown[]) {
  if (DEBUG) console.log("[BM/Debug]", ...args)
}

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "blackmeetings" },
  })
  return {
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

async function main() {
  console.log(`[BM/Ingest] Starting at ${new Date().toISOString()}`)
  console.log(`[BM/Ingest] Config: runId=${runId ?? "none"} dateFrom=${dateFrom?.toISOString()?.slice(0, 10) ?? "any"} dateTo=${dateTo?.toISOString()?.slice(0, 10) ?? "any"} DEBUG=${DEBUG}`)

  const config = await getConfig()
  console.log(`[BM/Ingest] IngestConfig: active=${config.active}`)
  if (!config.active) {
    console.log("[BM/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, dbVenues, sourceSite] = await Promise.all([
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
      where: { name: "blackmeetingsandtourism.com" },
      select: { id: true },
    }),
  ])

  const sourceSiteId = sourceSite?.id ?? null
  console.log(`[BM/Ingest] Loaded ${locations.length} active locations, ${dbVenues.length} active venues, sourceSite=${sourceSiteId ?? "NOT FOUND"}`)
  debug("Locations:", locations.map((l) => `${l.id} | ${l.name} | city=${l.city} state=${l.state}`))

  // Build venue name lookup for venue matching
  const venueMap = new Map<string, typeof dbVenues[number]>()
  for (const venue of dbVenues) {
    const key = venue.name.toLowerCase()
    venueMap.set(key, venue)
  }

  // ─── Step 1: Scrape convention centers and upsert as Locations ───
  console.log("[BM/Ingest] Scraping convention centers...")
  const scrapedVenues = await scrapeBMVenues({ maxVenues: 50 })
  console.log(`[BM/Ingest] ${scrapedVenues.length} venues scraped`)
  debug("Raw venues:", scrapedVenues.map((v) => `${v.name} | url=${v.detailUrl}`))

  let venuesCreated = 0
  for (const venue of scrapedVenues) {
    const existing = await prisma.location.findFirst({
      where: {
        name: { equals: venue.name, mode: "insensitive" },
      },
    })
    if (!existing) {
      await prisma.location.create({
        data: {
          type: "VENUE",
          name: venue.name,
          sourceUrl: venue.detailUrl,
          active: true,
        },
      })
      venuesCreated++
      console.log(`[BM/Ingest] Created venue location: "${venue.name}" url=${venue.detailUrl}`)
    }
  }
  console.log(`[BM/Ingest] ${venuesCreated} new venues added as locations`)

  // Refresh locations and venues so events can match against freshly created venues
  const [allLocations, allVenues] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { id: "asc" },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true, state: true },
    }),
  ])
  console.log(`[BM/Ingest] Refreshed to ${allLocations.length} total locations, ${allVenues.length} total venues`)

  // Rebuild venue map with refreshed venues
  const refreshedVenueMap = new Map<string, typeof allVenues[number]>()
  for (const venue of allVenues) {
    const key = venue.name.toLowerCase()
    refreshedVenueMap.set(key, venue)
  }

  // ─── Step 2: Scrape Current Events ───
  console.log("[BM/Ingest] Scraping current events...")
  const allEvents = await scrapeBMEvents({
    sections: ["current-events", "facilities-update"],
    maxDetailPages: 100,
  })
  console.log(`[BM/Ingest] ${allEvents.length} events scraped`)

  if (allEvents.length > 0) {
    debug("First 5 raw events:")
    for (const ev of allEvents.slice(0, 5)) {
      debug(`  "${ev.title}"`)
      debug(`    venue="${ev.venueName}" location="${ev.venueLocation}" date=${ev.eventDateStart?.toISOString()?.slice(0, 10) ?? "null"}`)
      debug(`    url=${ev.detailUrl}`)
      debug(`    contacts=${JSON.stringify(ev.contacts)}`)
    }
  }

  let totalFound = 0
  let totalNew = 0
  let skippedNoLocation = 0
  let skippedDuplicate = 0
  let skippedDateRange = 0
  let withContact = 0
  let withoutContact = 0

  for (const ev of allEvents) {
    totalFound++

    // Match city/state first
    const cityLoc = matchLocation(ev, allLocations)
    if (!cityLoc) {
      skippedNoLocation++
      debug(`Skip (no city match): "${ev.title}" venue="${ev.venueName}" location="${ev.venueLocation}"`)
      continue
    }

    if (dateFrom && ev.eventDateStart && ev.eventDateStart < dateFrom) {
      skippedDateRange++
      debug(`Skip (before dateFrom): "${ev.title}" date=${ev.eventDateStart.toISOString().slice(0, 10)}`)
      continue
    }
    if (dateTo && ev.eventDateStart && ev.eventDateStart > dateTo) {
      skippedDateRange++
      debug(`Skip (after dateTo): "${ev.title}" date=${ev.eventDateStart.toISOString().slice(0, 10)}`)
      continue
    }

    // Match venue name if provided
    let venueId: string | null = null
    let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"
    if (ev.venueName) {
      const venueKey = ev.venueName.toLowerCase()
      const matchedVenue = refreshedVenueMap.get(venueKey)
      if (matchedVenue) {
        venueId = matchedVenue.id
        matchType = "venue_matched"
      }
    }

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.title, mode: "insensitive" },
      },
    })
    if (existing) {
      skippedDuplicate++
      debug(`Skip (duplicate): "${ev.title}" id=${existing.id}`)
      continue
    }

    const primaryContact = ev.contacts?.[0] ?? null
    const hasContact = primaryContact && (primaryContact.name || primaryContact.email)

    debug(`Processing: "${ev.title}" → city="${cityLoc.name}" (${cityLoc.id}) venue="${ev.venueName ?? "none"}"`)
    debug(`  sourceUrl=${ev.detailUrl}`)
    debug(`  contact: name="${primaryContact?.name ?? ""}" email="${primaryContact?.email ?? ""}" phone="${primaryContact?.phone ?? ""}"`)

    const event = await prisma.event.create({
      data: {
        locationId: cityLoc.id,
          venueId: venueId ?? undefined,
        matchType,
        eventName: ev.title,
        eventDateStart: ev.eventDateStart ?? undefined,
        eventDateEnd: ev.eventDateEnd ?? undefined,
        sourceUrl: ev.detailUrl ?? null,
        sourceSiteId,
        runId: runId ?? undefined,
        expectedAttendees: null,
        rawVenueText: ev.venueName ?? null,
        rawLocationText: ev.venueLocation ?? null,
        organizerName: primaryContact?.name ?? null,
        organizerPhone: primaryContact?.phone ?? null,
        organizerEmail: primaryContact?.email ?? null,
      },
    })
    totalNew++
    debug(`  Saved event id=${event.id}`)

    if (hasContact) {
      withContact++
      await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: primaryContact!.name ?? "",
          email: primaryContact!.email,
          phone: primaryContact!.phone,
          isPrimary: true,
          sourceUrl: ev.detailUrl ?? null,
          confidence: "medium",
        },
      })
      console.log(`[BM/Ingest] ✓ Saved "${ev.title}" — venue="${ev.venueName ?? "none"}" name="${primaryContact!.name}" email="${primaryContact!.email}" phone="${primaryContact!.phone}" url=${ev.detailUrl}`)
    } else {
      withoutContact++
      console.log(`[BM/Ingest] ✗ No contact for "${ev.title}" url=${ev.detailUrl}`)
    }
  }

  console.log(`\n[BM/Ingest] ═══════════════════════════════════════`)
  console.log(`[BM/Ingest] SUMMARY`)
  console.log(`[BM/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[BM/Ingest]   No location:      ${skippedNoLocation}`)
  console.log(`[BM/Ingest]   Date filtered:    ${skippedDateRange}`)
  console.log(`[BM/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[BM/Ingest]   New saved:        ${totalNew}`)
  console.log(`[BM/Ingest]     with contact:   ${withContact}`)
  console.log(`[BM/Ingest]     without contact: ${withoutContact}`)
  console.log(`[BM/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

function matchLocation(
  ev: { title: string; venueName: string | null; venueLocation: string | null; bodyText: string | null },
  locations: { id: string; name: string; city: string | null; state: string | null }[]
): { id: string; name: string } | null {
  const venueLower = ev.venueName?.toLowerCase().trim() ?? ""
  const locationLower = ev.venueLocation?.toLowerCase().trim() ?? ""
  const titleLower = ev.title.toLowerCase()
  const bodyLower = ev.bodyText?.toLowerCase() ?? ""
  const searchText = `${titleLower} ${venueLower} ${locationLower} ${bodyLower}`

  // 1. Exact venue name match against location name
  if (venueLower) {
    for (const loc of locations) {
      if (loc.name.toLowerCase() === venueLower) {
        debug(`  Location match (exact venue name): "${loc.name}"`)
        return loc
      }
    }
  }

  // 2. Venue name substring match against location name (e.g. "Pennsylvania Convention Center" in "Pennsylvania Convention Center - Philadelphia")
  if (venueLower) {
    for (const loc of locations) {
      const locName = loc.name.toLowerCase()
      if (locName.includes(venueLower) || venueLower.includes(locName)) {
        debug(`  Location match (venue substring): "${loc.name}"`)
        return loc
      }
    }
  }

  // 3. Venue name contains location name or vice versa (word-level)
  if (venueLower) {
    for (const loc of locations) {
      const locName = loc.name.toLowerCase()
      const venueWords = venueLower.split(/\s+/)
      const locWords = locName.split(/\s+/)
      // Check if most words overlap
      const overlap = venueWords.filter((w) => locWords.includes(w) && w.length > 3)
      if (overlap.length >= 2) {
        debug(`  Location match (word overlap "${overlap.join(", ")}"): "${loc.name}"`)
        return loc
      }
    }
  }

  // 4. City + state both present in any text field
  for (const loc of locations) {
    const city = loc.city?.toLowerCase()
    const state = loc.state?.toLowerCase()
    if (city && state && searchText.includes(city) && searchText.includes(state)) {
      debug(`  Location match (city+state): "${loc.name}"`)
      return loc
    }
  }

  // 5. Venue name matches location name exactly (case-insensitive)
  for (const loc of locations) {
    const name = loc.name.toLowerCase()
    if (name && searchText.includes(name)) {
      debug(`  Location match (name in text): "${loc.name}"`)
      return loc
    }
  }

  // 6. City name alone in text
  for (const loc of locations) {
    const city = loc.city?.toLowerCase()
    if (city && searchText.includes(city)) {
      debug(`  Location match (city only): "${loc.name}"`)
      return loc
    }
  }

  debug(`  No location match for venue="${ev.venueName}" location="${ev.venueLocation}"`)
  return null
}

main()
  .catch((e) => {
    console.error("[BM/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
