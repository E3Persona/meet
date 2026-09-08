import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { scrapeECN, type ECNEvent } from "../lib/scrapers/thetradeshowcalendar"
import { statesMatch } from "../lib/stateNormalize"
import { matchVenue, buildVenueMap } from "../lib/venueResolution"
import { startIngestRun, finishIngestRun } from "../lib/ingest-run"
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "thetradeshowcalendar" },
  })
  return {
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
    batchSize: cfg?.batchSize ?? 5,
    batchDelayMs: cfg?.batchDelayMs ?? 10_000,
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
  const ctx = await startIngestRun((process.env.TRIGGER as any) || "manual")
  console.log(`[TheTradeShowCalendar/Ingest] Starting at ${new Date().toISOString()}`)
  if (ctx.runId) console.log(`[TheTradeShowCalendar/Ingest] Run ID: ${ctx.runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[TheTradeShowCalendar/Ingest] Scraping disabled via IngestConfig")
    await finishIngestRun(ctx, { recordsFound: 0, recordsNew: 0 })
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
      where: { name: "exhibitcitynews.com" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[TheTradeShowCalendar/Ingest] No active locations")
    await finishIngestRun(ctx, { recordsFound: 0, recordsNew: 0 })
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  // Build venue name lookup for venue matching
  const venueMap = buildVenueMap(venues)

  let totalFound = 0
  let totalNew = 0

  // Keep DB connection alive during long scrape
  await withRetry(() => prisma.$queryRaw`SELECT 1`)

  async function processBatch(events: ECNEvent[]) {
    for (const ev of events) {
      totalFound++

      const loc = matchCityState(ev.venueCity, ev.venueState, locations)
      if (!loc) continue

      const existing = await withRetry(() =>
        prisma.event.findFirst({
          where: {
            eventName: { equals: ev.eventName, mode: "insensitive" },
          },
        })
      )
      if (existing) continue

      const { start, end } = parseRange(ev.eventDateStart, ev.eventDateEnd)

      if (dateFrom && start && start < dateFrom) continue
      if (dateTo && start && start > dateTo) continue
      // Match venue name if provided
      const venueMatch = matchVenue(ev.venueName, ev.venueCity, venueMap, venues)
      let venueId: string | null = venueMatch.venueId
      let matchType: import("../lib/generated/prisma/client").EventMatchType = venueMatch.matchType

      const contact = ev.contacts?.[0] ?? null
      const hasContact = contact && (contact.organizerName || contact.organizerEmail)

      const event = await withRetry(() =>
        prisma.event.create({
          data: {
            locationId: loc.id,
            venueId: venueId ?? undefined,
            matchType,
            eventName: ev.eventName,
            eventDateStart: start ?? undefined,
            eventDateEnd: end ?? undefined,
            sourceUrl: ev.officialWebsite || null,
            sourceSiteId,
          runId: ctx.runId ?? undefined,
          expectedAttendees: ev.attendees ?? null,
            organizerName: contact?.organizerName ?? null,
            organizerEmail: contact?.organizerEmail ?? null,
            organizerPhone: contact?.organizerPhone ?? null,
            rawLocationText: ev.venueCity && ev.venueState ? `${ev.venueCity}, ${ev.venueState}` : null,
            rawVenueText: ev.venueName ?? null,
          },
        })
      )
      totalNew++

      if (hasContact) {
        await withRetry(() =>
          prisma.eventContact.create({
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
        )
      }
    }
  }

  const result = await scrapeECN(
    {
      country: "United States",
      skipContacts: false,
      maxContactLookups: 30,
      batchSize: config.batchSize,
      batchDelayMs: config.batchDelayMs,
    },
    processBatch
  )

  console.log(`[TheTradeShowCalendar/Ingest] Complete: ${totalNew} new from ${totalFound} across ${result.totalBatches} batches`)
  await finishIngestRun(ctx, { recordsFound: totalFound, recordsNew: totalNew })
  return { recordsFound: totalFound, recordsNew: totalNew }
}

function matchCityState(
  city: string,
  state: string | null,
  locations: { id: string; name: string; city: string | null; state: string | null }[]
): { id: string } | null {
  const c = city.toLowerCase().trim()

  for (const loc of locations) {
    const lc = loc.city?.toLowerCase().trim()
    if (lc === c && (!state || !loc.state || statesMatch(loc.state, state))) return loc
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
