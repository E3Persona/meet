import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeECN } from "../lib/scrapers/thetradeshowcalendar"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "thetradeshowcalendar" },
  })
  return {
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

function parseBMDatestr(raw: string): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  const m = raw.match(/(\w{3})\s+(\d{1,2})(?:-\d{1,2})?,\s*(\d{4})/i)
  if (!m) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  const mon = months[m[1].toLowerCase()]
  if (mon === undefined) return null
  return new Date(parseInt(m[3]), mon, parseInt(m[2]))
}

function parseRange(rawStart: string, rawEnd: string | null): { start: Date | null; end: Date | null } {
  const start = parseBMDatestr(rawStart)
  const end = rawEnd ? parseBMDatestr(rawEnd) : null
  return { start, end }
}

async function main() {
  console.log(`[TheTradeShowCalendar/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[TheTradeShowCalendar/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[TheTradeShowCalendar/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { id: "asc" },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "exhibitcitynews.com" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[TheTradeShowCalendar/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  const allEvents = await scrapeECN({
    country: "United States",
    skipContacts: false,
    maxContactLookups: 30,
  })
  console.log(`[TheTradeShowCalendar/Ingest] ${allEvents.length} events scraped`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    const loc = matchCityState(ev.venueCity, ev.venueState, locations)
    if (!loc) continue

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.eventName, mode: "insensitive" },
        locationId: loc.id,
      },
    })
    if (existing) continue

    const { start, end } = parseRange(ev.eventDateStart, ev.eventDateEnd)
    const contact = ev.contacts?.[0] ?? null
    const hasContact = contact && (contact.organizerName || contact.organizerEmail)

    const event = await prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.eventName,
        eventDateStart: start ?? undefined,
        eventDateEnd: end ?? undefined,
        sourceUrl: ev.officialWebsite || ev.venueName ? undefined : null,
        sourceSiteId,
        runId: runId ?? undefined,
        organizerName: contact?.organizerName ?? null,
        organizerEmail: contact?.organizerEmail ?? null,
        organizerPhone: contact?.organizerPhone ?? null,
      },
    })
    totalNew++

    if (hasContact) {
      await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: contact!.organizerName ?? "",
          email: contact!.organizerEmail,
          phone: contact!.organizerPhone,
          isPrimary: true,
          sourceUrl: ev.officialWebsite ?? null,
          confidence: "medium",
        },
      })
      console.log(`[TheTradeShowCalendar/Ingest] Saved contact for "${ev.eventName}"`)
    }
  }

  console.log(`[TheTradeShowCalendar/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

function matchCityState(
  city: string,
  state: string | null,
  locations: { id: string; name: string; city: string | null; state: string | null }[]
): { id: string } | null {
  const c = city.toLowerCase().trim()
  const s = (state ?? "").toLowerCase().trim()

  for (const loc of locations) {
    const lc = loc.city?.toLowerCase().trim()
    const ls = loc.state?.toLowerCase().trim()
    if (lc === c && (!s || !ls || ls === s)) return loc
  }

  // fallback: location name contains the city
  for (const loc of locations) {
    if (loc.name.toLowerCase().includes(c)) return loc
  }

  return null
}

main()
  .catch((e) => {
    console.error("[TheTradeShowCalendar/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
