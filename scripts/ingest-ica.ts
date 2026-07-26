import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeICA, cityToIcaSlug } from "../lib/scrapers/ica"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

const ICA_MONTHS = [
  "july", "august", "september", "october",
  "november", "december", "january", "february",
  "march", "april", "may", "june",
]

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "ica" },
  })
  return {
    maxMonths: cfg?.maxMonths ?? 6,
    maxPages: cfg?.maxPages ?? 3,
    maxLocations: cfg?.maxLocations ?? 0,
    active: cfg?.active ?? true,
  }
}

async function main() {
  console.log(`[ICA/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[ICA/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[ICA/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[ICA/Ingest] Config: maxMonths=${config.maxMonths}, maxPages=${config.maxPages}`)

  const [locations, venues, icaSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "internationalconferencealerts.com" },
      select: { id: true },
    }),
  ])

  // Filter to only cities that ICA can target
  const icaLocations = locations.filter((loc) => {
    const slug = cityToIcaSlug(loc.city ?? "", loc.state ?? "")
    return slug !== null
  })

  if (icaLocations.length === 0) {
    console.log("[ICA/Ingest] No active locations with ICA slugs")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const runLocations = config.maxLocations > 0
    ? icaLocations.slice(0, config.maxLocations)
    : icaLocations
  const pagesPerBatch = 5
  console.log(`[ICA/Ingest] ${icaLocations.length} ICA-supported locations, running ${runLocations.length}, pagesPerBatch=${pagesPerBatch}`)

  const sourceSiteId = icaSite?.id ?? null
  const upcomingMonths = ICA_MONTHS.slice(0, config.maxMonths)

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

  const slugsToScrape = runLocations
    .map((loc) => cityToIcaSlug(loc.city ?? "", loc.state ?? ""))
    .filter((s): s is string => s !== null)

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedDateRange = 0
  let skippedNoLocation = 0
  let withContact = 0
  let withoutContact = 0
  let batchNum = 0

  const saveBatch = async (events: import("../lib/scrapers/ica").ICAEvent[]) => {
    batchNum++
    console.log(`\n[ICA/Ingest] === Batch ${batchNum}: saving ${events.length} events ===`)
    for (const ev of events) {
      totalFound++

      // Match scraped city/state to our city locations
      const locKey = `${ev.venueCity}|${ev.venueState ?? ""}`.toLowerCase()
      const cityLoc = cityLocMap.get(locKey)
      if (!cityLoc) {
        skippedNoLocation++
        console.log(`[ICA/Ingest] Skip (no city match): "${ev.eventName}" city="${ev.venueCity}" state="${ev.venueState}"`)
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
        continue
      }
      if (dateTo && eventDateStart && eventDateStart > dateTo) {
        skippedDateRange++
        continue
      }

      // Match venue name if provided
      let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"
      let venueId: string | null = null
      if (ev.venueFullName) {
        const venueKey = ev.venueFullName.toLowerCase()
        const matchedVenue = venueMap.get(venueKey)
        if (matchedVenue) {
          matchType = "venue_matched"
          venueId = matchedVenue.id
        }
      }

      const existing = await prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
        },
      })
      if (existing) {
        skippedDuplicate++
        continue
      }

      const contacts = ev.contacts ?? []
      const primaryContact = contacts[0]

      const event = await prisma.event.create({
        data: {
          locationId: cityLoc.id,
          venueId,
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
        },
      })
      totalNew++

      if (contacts.length > 0) {
        let saved = false
        for (const c of contacts) {
          if (!c.organizerName && !c.organizerEmail) continue
          await prisma.eventContact.create({
            data: {
              eventId: event.id,
              name: c.organizerName ?? "",
              title: c.organizerOrg,
              email: c.organizerEmail,
              phone: c.organizerPhone,
              isPrimary: !saved,
              sourceUrl: ev.eventUrl,
              confidence: "high",
            },
          })
          saved = true
        }
        if (saved) {
          withContact++
          console.log(`[ICA/Ingest] ✓ Saved "${ev.eventName}" — city="${ev.venueCity}" venue="${ev.venueFullName ?? "none"}" name="${primaryContact?.organizerName ?? ""}" email="${primaryContact?.organizerEmail ?? ""}"`)
        } else {
          withoutContact++
        }
      } else {
        withoutContact++
      }
    }
    console.log(`[ICA/Ingest] === Batch ${batchNum} done ===`)
  }

  try {
    console.log(`\n[ICA/Ingest] Starting single scrape across ${slugsToScrape.length} cities, saving every ${pagesPerBatch} pages...`)
    const { events } = await scrapeICA({
      citySlugs: slugsToScrape,
      months: upcomingMonths,
      maxPagesPerSlug: config.maxPages,
      skipDetailPages: false,
      pagesPerBatch,
      onBatch: saveBatch,
    })
    console.log(`[ICA/Ingest] Scrape complete: ${events.length} events total`)
  } catch (err) {
    console.error(`[ICA/Ingest] Error during scrape:`, err)
  }

  console.log(`\n[ICA/Ingest] ═══════════════════════════════════════`)
  console.log(`[ICA/Ingest] SUMMARY`)
  console.log(`[ICA/Ingest]   Total scraped:     ${totalFound}`)
  console.log(`[ICA/Ingest]   No location match: ${skippedNoLocation}`)
  console.log(`[ICA/Ingest]   Date filtered:     ${skippedDateRange}`)
  console.log(`[ICA/Ingest]   Duplicates:        ${skippedDuplicate}`)
  console.log(`[ICA/Ingest]   New saved:         ${totalNew}`)
  console.log(`[ICA/Ingest]     with contact:    ${withContact}`)
  console.log(`[ICA/Ingest]     without contact: ${withoutContact}`)
  console.log(`[ICA/Ingest]   Batches:           ${batchNum}`)
  console.log(`[ICA/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[ICA/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
