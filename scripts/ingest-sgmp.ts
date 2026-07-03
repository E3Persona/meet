import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeSgmpEvents } from "../lib/scrapers/sgmp"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null

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

  for (const loc of locations) {
    const name = loc.name.toLowerCase()
    const city = loc.city?.toLowerCase()
    const state = loc.state?.toLowerCase()

    if (ev.venueCity && ev.venueState && city && state) {
      if (
        ev.venueCity.toLowerCase().includes(city) &&
        ev.venueState.toLowerCase() === state
      )
        return loc
    }
    if (city && state && searchText.includes(city) && searchText.includes(state)) return loc
    if (name && searchText.includes(name)) return loc
    if (city && searchText.includes(city)) return loc
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

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { id: "asc" },
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

  const allEvents = await scrapeSgmpEvents({ maxMonths: config.maxMonths })
  console.log(`[SGMP/Ingest] ${allEvents.length} events scraped`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    const loc = matchLocation(ev, locations)
    if (!loc) continue

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.eventName, mode: "insensitive" },
        locationId: loc.id,
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

    const hasContact = ev.contactName || ev.contactEmail

    const event = await prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.eventName,
        eventDateStart,
        eventDateEnd,
        sourceUrl: ev.sourceUrl,
        sourceSiteId,
        runId: runId ?? undefined,
        organizerName: ev.contactName ?? null,
        organizerEmail: ev.contactEmail ?? null,
        organizerPhone: ev.contactPhone ?? null,
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
