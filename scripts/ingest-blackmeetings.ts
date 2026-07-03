import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeBMEvents, scrapeBMVenues } from "../lib/scrapers/blackmeetings"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null

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
  console.log(`[BlackMeetings/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[BlackMeetings/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[BlackMeetings/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { id: "asc" },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "blackmeetingsandtourism.com" },
      select: { id: true },
    }),
  ])

  const sourceSiteId = sourceSite?.id ?? null

  // ─── Step 1: Scrape convention centers and upsert as Locations ───
  console.log("[BlackMeetings/Ingest] Scraping convention centers...")
  const venues = await scrapeBMVenues({ maxVenues: 50 })
  console.log(`[BlackMeetings/Ingest] ${venues.length} venues scraped`)

  let venuesCreated = 0
  for (const venue of venues) {
    const existing = await prisma.location.findFirst({
      where: {
        name: { equals: venue.name, mode: "insensitive" },
      },
    })
    if (!existing) {
      await prisma.location.create({
        data: {
          name: venue.name,
          sourceUrl: venue.detailUrl,
          active: true,
        },
      })
      venuesCreated++
    }
  }
  console.log(`[BlackMeetings/Ingest] ${venuesCreated} new venues added as locations`)

  // Refresh locations so events can match against freshly created venues
  const allLocations = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, name: true, city: true, state: true },
    orderBy: { id: "asc" },
  })

  // ─── Step 2: Scrape Current Events ───
  console.log("[BlackMeetings/Ingest] Scraping current events...")
  const allEvents = await scrapeBMEvents({
    sections: ["current-events", "facilities-update"],
    maxDetailPages: 100,
  })
  console.log(`[BlackMeetings/Ingest] ${allEvents.length} events scraped`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    const loc = matchLocation(ev, allLocations)
    if (!loc) continue

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.title, mode: "insensitive" },
        locationId: loc.id,
      },
    })
    if (existing) continue

    const primaryContact = ev.contacts?.[0] ?? null
    const hasContact = primaryContact && (primaryContact.name || primaryContact.email)

    await prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.title,
        eventDateStart: ev.eventDateStart ?? undefined,
        eventDateEnd: ev.eventDateEnd ?? undefined,
        sourceUrl: ev.detailUrl ?? null,
        sourceSiteId,
        runId: runId ?? undefined,
        organizerName: primaryContact?.name ?? null,
        organizerPhone: primaryContact?.phone ?? null,
        organizerEmail: primaryContact?.email ?? null,
      },
    })
    totalNew++
  }

  console.log(`[BlackMeetings/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

function matchLocation(
  ev: { title: string; venueName: string | null; venueLocation: string | null; bodyText: string | null },
  locations: { id: string; name: string; city: string | null; state: string | null }[]
): { id: string } | null {
  const searchText = [
    ev.title,
    ev.venueName ?? "",
    ev.venueLocation ?? "",
    ev.bodyText ?? "",
  ]
    .join(" ")
    .toLowerCase()

  for (const loc of locations) {
    const name = loc.name.toLowerCase()
    const city = loc.city?.toLowerCase()
    const state = loc.state?.toLowerCase()

    if (city && state) {
      if (searchText.includes(city) && searchText.includes(state)) {
        return loc
      }
    }
    if (name && searchText.includes(name)) return loc
    if (city && searchText.includes(city)) return loc
  }

  return null
}

main()
  .catch((e) => {
    console.error("[BlackMeetings/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
