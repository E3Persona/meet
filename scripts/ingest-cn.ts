import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeCN, cityToCnSlug } from "../lib/scrapers/conferencenext"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true"

function debug(...args: unknown[]) {
  if (DEBUG) console.log("[CN/Debug]", ...args)
}

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "cn" },
  })
  return {
    maxPages: cfg?.maxPages ?? 3,
    maxLocations: cfg?.maxLocations ?? 0,
    active: cfg?.active ?? true,
  }
}

async function main() {
  console.log(`[CN/Ingest] Starting at ${new Date().toISOString()}`)
  console.log(`[CN/Ingest] Config: runId=${runId ?? "none"} dateFrom=${dateFrom?.toISOString()?.slice(0, 10) ?? "any"} dateTo=${dateTo?.toISOString()?.slice(0, 10) ?? "any"} DEBUG=${DEBUG}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[CN/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[CN/Ingest] Config: maxPages=${config.maxPages} maxLocations=${config.maxLocations}`)

  const [locations, venues, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "conferencenext.com" },
      select: { id: true },
    }),
  ])

  const sourceSiteId = sourceSite?.id ?? null
  console.log(`[CN/Ingest] Loaded ${locations.length} active locations, sourceSite=${sourceSiteId ?? "NOT FOUND"}`)

  const cnLocations = locations.filter((loc) => {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    return slug !== null
  })

  const skippedLocations = locations.filter((loc) => {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    return slug === null
  })

  if (skippedLocations.length > 0) {
    debug(`${skippedLocations.length} locations have no CN slug:`, skippedLocations.map((l) => `${l.name} (${l.city}, ${l.state})`))
  }

  if (cnLocations.length === 0) {
    console.log("[CN/Ingest] No active locations with CN slugs")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const runLocations = config.maxLocations > 0
    ? cnLocations.slice(0, config.maxLocations)
    : cnLocations
  const pagesPerBatch = 5
  console.log(`[CN/Ingest] ${cnLocations.length} CN-supported locations, running ${runLocations.length}, pagesPerBatch=${pagesPerBatch}:`)
  for (const loc of runLocations) {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    console.log(`  - "${loc.name}" (${loc.city}, ${loc.state}) → slug="${slug}"`)
  }

  // Build cityKey -> location lookup for city matching
  const cityLocMap = new Map<string, typeof runLocations[number]>()
  for (const loc of runLocations) {
    const key = `${loc.city ?? ""}|${loc.state ?? ""}`.toLowerCase()
    cityLocMap.set(key, loc)
  }

  // Build venue name lookup for venue matching
  const venueMap = new Map<string, typeof venues[number]>()
  for (const venue of venues) {
    const key = venue.name.toLowerCase()
    venueMap.set(key, venue)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedDateRange = 0
  let skippedNoLocation = 0
  let withContact = 0
  let withoutContact = 0
  let batchNum = 0

  const slugsToScrape = runLocations
    .map((loc) => cityToCnSlug(loc.city ?? "", loc.state ?? ""))
    .filter((s): s is string => s !== null)

  const saveBatch = async (events: import("../lib/scrapers/conferencenext").CNEvent[]) => {
    batchNum++
    console.log(`\n[CN/Ingest] === Batch ${batchNum}: saving ${events.length} events ===`)
    for (const ev of events) {
      totalFound++

      // Match scraped city/state to our city locations
      const locKey = `${ev.venueCity}|${ev.venueState ?? ""}`.toLowerCase()
      const cityLoc = cityLocMap.get(locKey)
      if (!cityLoc) {
        skippedNoLocation++
        debug(`Skip (no city match): "${ev.eventName}" city="${ev.venueCity}" state="${ev.venueState}"`)
        continue
      }

      let eventDateStart: Date | null = null
      let eventDateEnd: Date | null = null
      if (ev.eventDateStart) {
        const d = new Date(ev.eventDateStart)
        if (!isNaN(d.getTime())) eventDateStart = d
      }
      if (ev.eventDateEnd) {
        const d = new Date(ev.eventDateEnd)
        if (!isNaN(d.getTime())) eventDateEnd = d
      }

      if (dateFrom && eventDateStart && eventDateStart < dateFrom) {
        skippedDateRange++
        debug(`Skip (before dateFrom): "${ev.eventName}" date=${eventDateStart.toISOString().slice(0, 10)}`)
        continue
      }
      if (dateTo && eventDateStart && eventDateStart > dateTo) {
        skippedDateRange++
        debug(`Skip (after dateTo): "${ev.eventName}" date=${eventDateStart.toISOString().slice(0, 10)}`)
        continue
      }

      // Match venue name if provided (CN doesn't provide venue names, but we keep the logic for consistency)
      let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"
      // ConferenceNext doesn't provide venueFullName, so we can't match venues

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

      const contacts = ev.contacts ?? []
      const primaryContact = contacts.find((c) => c.organizerEmail) ?? contacts[0]

      debug(`Processing: "${ev.eventName}" → city="${ev.venueCity}" (${cityLoc.id})`)
      debug(`  sourceUrl=${ev.eventUrl}`)
      debug(`  contact: name="${primaryContact?.organizerName ?? ""}" email="${primaryContact?.organizerEmail ?? ""}" phone="${primaryContact?.organizerPhone ?? ""}" org="${primaryContact?.organizerOrg ?? ""}"`)

      let venueId: string | null = null
      const event = await prisma.event.create({
        data: {
          locationId: cityLoc.id,
          venueId: venueId ?? undefined,
          matchType,
          eventName: ev.eventName,
          eventDateStart,
          eventDateEnd,
          sourceUrl: ev.eventUrl,
          sourceSiteId,
          runId: runId ?? undefined,
          expectedAttendees: null,
          rawVenueText: ev.venueFullName ?? null,
          rawLocationText: `${ev.venueCity}, ${ev.venueState ?? ""}`.trim(),
          organizerName: primaryContact?.organizerName ?? null,
          organizerTitle: primaryContact?.organizerOrg ?? null,
          organizerEmail: primaryContact?.organizerEmail ?? null,
          organizerPhone: primaryContact?.organizerPhone ?? null,
        },
      })
      totalNew++

      let savedContact = false
      for (const c of contacts) {
        if (!c.organizerName && !c.organizerEmail) continue
        await prisma.eventContact.create({
          data: {
            eventId: event.id,
            name: c.organizerName ?? "",
            title: c.organizerOrg,
            email: c.organizerEmail,
            phone: c.organizerPhone,
            isPrimary: !savedContact,
            sourceUrl: ev.eventUrl,
            confidence: "high",
          },
        })
        savedContact = true
      }

      if (savedContact) {
        withContact++
        console.log(`[CN/Ingest] ✓ Saved "${ev.eventName}" — city="${ev.venueCity}" name="${primaryContact?.organizerName ?? ""}" email="${primaryContact?.organizerEmail ?? ""}"`)
      } else {
        withoutContact++
        console.log(`[CN/Ingest] ✗ No contact for "${ev.eventName}" url=${ev.eventUrl}`)
      }
    }
    console.log(`[CN/Ingest] === Batch ${batchNum} done: ${events.length} processed ===`)
  }

  try {
    console.log(`\n[CN/Ingest] Starting single scrape run across all ${slugsToScrape.length} cities, saving to DB every ${pagesPerBatch} pages...`)
    const { events, hasMore } = await scrapeCN({
      citySlugs: slugsToScrape,
      maxPagesPerCity: config.maxPages,
      skipDetailPages: false,
      pagesPerBatch,
      onBatch: saveBatch,
    })
    console.log(`[CN/Ingest] Scrape complete: ${events.length} events total, hasMore=${hasMore}`)
  } catch (err) {
    console.error(`[CN/Ingest] Error during scrape:`, err)
  }

  console.log(`\n[CN/Ingest] ═══════════════════════════════════════`)
  console.log(`[CN/Ingest] SUMMARY`)
  console.log(`[CN/Ingest]   Total scraped:     ${totalFound}`)
  console.log(`[CN/Ingest]   No location match: ${skippedNoLocation}`)
  console.log(`[CN/Ingest]   Date filtered:     ${skippedDateRange}`)
  console.log(`[CN/Ingest]   Duplicates:        ${skippedDuplicate}`)
  console.log(`[CN/Ingest]   New saved:         ${totalNew}`)
  console.log(`[CN/Ingest]     with contact:    ${withContact}`)
  console.log(`[CN/Ingest]     without contact: ${withoutContact}`)
  console.log(`[CN/Ingest]   Batches:           ${batchNum}`)
  console.log(`[CN/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[CN/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
