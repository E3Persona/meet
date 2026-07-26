import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeInfosecConferences } from "../lib/scrapers/infosec-conferences"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true"

function debug(...args: unknown[]) {
  if (DEBUG) console.log("[Infosec/Debug]", ...args)
}

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "infosec" },
  })
  return {
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

const STATE_NAME_TO_CODE: Record<string, string> = {
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
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
}

async function main() {
  console.log(`[Infosec/Ingest] Starting at ${new Date().toISOString()}`)
  console.log(
    `[Infosec/Ingest] Config: runId=${runId ?? "none"} dateFrom=${dateFrom?.toISOString()?.slice(0, 10) ?? "any"} dateTo=${dateTo?.toISOString()?.slice(0, 10) ?? "any"} DEBUG=${DEBUG}`
  )

  const config = await getConfig()
  console.log(
    `[Infosec/Ingest] IngestConfig: active=${config.active} maxLocations=${config.maxLocations}`
  )
  if (!config.active) {
    console.log("[Infosec/Ingest] Scraping disabled via IngestConfig")
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
      where: {
        OR: [
          { name: "https://infosec-conferences.com/country/united-states" },
          { name: "infosec-conferences.com/country/united-states" },
        ],
      },
      select: { id: true },
    }),
  ])

  console.log(
    `[Infosec/Ingest] Loaded ${locations.length} active locations, ${venues.length} active venues, sourceSite=${sourceSite?.id ?? "NOT FOUND, will create"}`
  )

  if (locations.length === 0) {
    console.log("[Infosec/Ingest] No active locations — nothing to do")
    return { recordsFound: 0, recordsNew: 0 }
  }

  // Build venue name lookup for venue matching
  const venueMap = new Map<string, typeof venues[number]>()
  for (const venue of venues) {
    const key = venue.name.toLowerCase()
    venueMap.set(key, venue)
  }

  // Ensure the source site exists
  let sourceSiteId = sourceSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "https://infosec-conferences.com/country/united-states",
        url: "https://infosec-conferences.com/country/united-states/",
        active: true,
        sourceMode: "automated",
        scrapeMode: "directory",
      },
    })
    sourceSiteId = created.id
    console.log(`[Infosec/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  // Build the target locations: group by (cityName, stateCode) for deduplication
  const targetLocationMap = new Map<string, { cityName: string; stateCode: string; locationIds: string[] }>()
  for (const loc of locations) {
    const city = loc.city?.trim()
    const state = loc.state?.trim()
    if (!city || !state) {
      debug(`Skipping location with missing city/state: ${loc.name}`)
      continue
    }
    const key = `${norm(city)}|${state.toUpperCase()}`
    if (!targetLocationMap.has(key)) {
      targetLocationMap.set(key, { cityName: city, stateCode: state.toUpperCase(), locationIds: [] })
    }
    targetLocationMap.get(key)!.locationIds.push(loc.id)
  }

  const targetLocations = [...targetLocationMap.values()]
  console.log(`[Infosec/Ingest] ${targetLocations.length} target city+state combos:`)
  for (const t of targetLocations) {
    console.log(`  - "${t.cityName}, ${t.stateCode}" → ${t.locationIds.length} location(s)`)
  }
  console.log(`[Infosec/Ingest] targetLocationMap keys:`, [...targetLocationMap.keys()].slice(0, 10))

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedDateRange = 0

  try {
    console.log(`[Infosec/Ingest] Starting scrape...`)
    const scrapeStart = Date.now()

    const events = await scrapeInfosecConferences({
      targetLocations,
      fetchDetails: true,
    })

    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(
      `[Infosec/Ingest] Scrape complete in ${scrapeDuration}s — ${events.length} total events`
    )

    if (events.length === 0) {
      console.warn("[Infosec/Ingest] WARNING: 0 events scraped")
    }

    if (events.length > 0) {
      debug("First 5 events:")
      for (const ev of events.slice(0, 5)) {
        debug(
          `  "${ev.eventName}" | city="${ev.city}" | date=${ev.eventDateStart ?? "null"} | attendees=${ev.expectedAttendees}`
        )
      }
    }

    for (const ev of events) {
      console.log(`[Infosec/Ingest] DEBUG: ev.city="${ev.city}" ev.state="${ev.state}" name="${ev.eventName}"`)
      const cityKey = norm(ev.city)
      const stateCode = STATE_NAME_TO_CODE[norm(ev.state)] ?? ev.state.toUpperCase()
      const matchKey = `${cityKey}|${stateCode}`
      const match = targetLocationMap.get(matchKey)
      if (!match) {
        debug(`Skip (no location match): "${ev.eventName}" city="${ev.city}", state="${ev.state}" → tried key="${matchKey}"`)
        continue
      }

      totalFound++

      let eventDate: Date | null = null
      if (ev.eventDateStart) {
        const d = new Date(ev.eventDateStart)
        if (!isNaN(d.getTime())) eventDate = d
      }

      if (dateFrom && eventDate && eventDate < dateFrom) {
        skippedDateRange++
        debug(
          `Skip (before dateFrom): "${ev.eventName}" date=${eventDate.toISOString().slice(0, 10)}`
        )
        continue
      }
      if (dateTo && eventDate && eventDate > dateTo) {
        skippedDateRange++
        debug(
          `Skip (after dateTo): "${ev.eventName}" date=${eventDate.toISOString().slice(0, 10)}`
        )
        continue
      }

      // Deduplicate: check by eventName + locationId + eventDateStart
      const existing = await prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
        },
      })
      if (existing) {
        skippedDuplicate++
        debug(`Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        continue
      }

      // Pick the "Others" venue as the catch-all, or first venue
      const locationIds = match.locationIds
      const catchAllIdx = locationIds.findIndex((id) => {
        const loc = locations.find((l) => l.id === id)
        return loc?.name?.toLowerCase().includes("other")
      })
      const locId = catchAllIdx >= 0 ? locationIds[catchAllIdx] : locationIds[0]

      // Infosec scraper doesn't provide venue names, so we only match at city level
      let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"

      // Build contactNote with event type and focus info
      const notes = [ev.eventType, ev.focus].filter(Boolean).join(" | ")

      const event = await prisma.event.create({
        data: {
          locationId: locId,
          matchType,
          eventName: ev.eventName,
          eventDateStart: eventDate,
          eventDateEnd: ev.eventDateEnd ? new Date(ev.eventDateEnd) : null,
          expectedAttendees: ev.expectedAttendees,
          sourceUrl: ev.sourceUrl,
          sourceSiteId,
          runId: runId ?? undefined,
          organizerName: ev.organizerName ?? null,
          organizerTitle: ev.focus ?? null,
          contactNote: notes || null,
          rawLocationText: `${ev.city}, ${ev.state}`,
          rawVenueText: null,
        },
      })
      totalNew++

      console.log(
        `[Infosec/Ingest] ✓ Saved "${ev.eventName}" (${ev.city}, ${ev.state})` +
          ` — org="${ev.organizerName ?? "N/A"}" type="${ev.eventType ?? "N/A"}" attendees=${ev.expectedAttendees ?? "N/A"}`
      )
    }
  } catch (err) {
    console.error(`[Infosec/Ingest] Error during scrape/ingest:`, err)
  }

  console.log(`\n[Infosec/Ingest] ═══════════════════════════════════════`)
  console.log(`[Infosec/Ingest] SUMMARY`)
  console.log(`[Infosec/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[Infosec/Ingest]   Date filtered:    ${skippedDateRange}`)
  console.log(`[Infosec/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[Infosec/Ingest]   New saved:        ${totalNew}`)
  console.log(`[Infosec/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Infosec/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
