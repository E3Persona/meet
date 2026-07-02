import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeTF } from "../lib/scrapers/tradefest"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "tf" },
  })
  return {
    maxPages: cfg?.maxPages ?? 5,
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

async function main() {
  console.log(`[TF/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[TF/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[TF/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[TF/Ingest] Config: maxPages=${config.maxPages}`)

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true },
      orderBy: { id: "asc" },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "tradefest.io" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[TF/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null
  const locationCities = new Set(locations.map((l) => l.city?.toLowerCase().trim()))

  // ── Pass 1: listing only (no slow detail page fetches) ─────────────────
  console.log(`[TF/Ingest] Pass 1: listing only (${locationCities.size} target cities)`)
  const allEvents = await scrapeTF({
    maxPages: config.maxPages,
    fetchDetails: false, // fast — listing pages only
  })

  // Filter to our cities and deduplicate
  const newCandidates: Array<{
    ev: (typeof allEvents)[number]
    loc: (typeof locations)[number]
    eventDateStart: Date | null
  }> = []

  for (const ev of allEvents) {
    const venueCity = ev.venue.city?.toLowerCase().trim()
    if (!venueCity || !locationCities.has(venueCity)) continue

    const loc = locations.find((l) => l.city?.toLowerCase().trim() === venueCity)!
    let eventDateStart: Date | null = null
    if (ev.eventDateStart) {
      const d = new Date(ev.eventDateStart)
      if (!isNaN(d.getTime())) eventDateStart = d
    }

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.eventName, mode: "insensitive" },
        locationId: loc.id,
        eventDateStart: eventDateStart ?? undefined,
      },
    })
    if (existing) continue

    newCandidates.push({ ev, loc, eventDateStart })
  }

  console.log(`[TF/Ingest] Pass 1: ${allEvents.length} total scraped, ${newCandidates.length} are new`)

  if (newCandidates.length === 0) {
    return { recordsFound: 0, recordsNew: 0 }
  }

  // ── Pass 2: detail pages only for new events ─────────────────────────
  console.log(`[TF/Ingest] Pass 2: fetching details for ${newCandidates.length} new events...`)
  const detailedEvents = await scrapeTF({
    maxPages: config.maxPages,
    fetchDetails: true,
  })

  const detailMap = new Map(detailedEvents.map((ev) => [ev.eventUrl, ev]))

  let totalFound = newCandidates.length
  let totalNew = 0

  for (const { ev, loc, eventDateStart } of newCandidates) {
    const detail = detailMap.get(ev.eventUrl)
    const org = detail?.organizer ?? ev.organizer
    const hasOrg = org.name || org.officialWebsite

    const event = await prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.eventName,
        eventDateStart,
        sourceUrl: ev.eventUrl,
        sourceSiteId,
        runId: runId ?? undefined,
        organizerName: org.name ?? null,
        organizerTitle: null,
        organizerEmail: null,
        organizerPhone: null,
      },
    })
    totalNew++

    if (hasOrg) {
      await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: org.name ?? "",
          title: null,
          email: null,
          phone: null,
          isPrimary: true,
          sourceUrl: org.officialWebsite ?? ev.eventUrl,
          confidence: "medium",
        },
      })
      console.log(`[TF/Ingest] Saved contact for "${ev.eventName}"`)
    }
  }

  console.log(`[TF/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[TF/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
