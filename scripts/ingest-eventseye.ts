import "dotenv/config"
import { scrapeEventseye } from "../lib/scrapers/eventseye"
import { prisma, withRetry } from "../lib/prisma"
import { matchVenue, buildVenueMap } from "../lib/venueResolution"

const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "eventseye" },
  })
  return {
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

async function main() {
  console.log(`[Eventseye/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[Eventseye/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[Eventseye/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[Eventseye/Ingest] Config: active=${config.active}, maxLocations=${config.maxLocations}`)

  const [locations, venues, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true },
      orderBy: { id: "asc" },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "eventseye.com" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[Eventseye/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  // Build city->location lookup
  const cityLocMap = new Map<string, (typeof locations)[number]>()
  for (const loc of locations) {
    const c = loc.city?.toLowerCase().trim()
    if (c) cityLocMap.set(c, loc)
  }

  // Build venue name lookup for venue matching
  const venueMap = buildVenueMap(venues)

  // Keepalive ping to prevent Neon P1017 connection drops during long scrapes
  await withRetry(() => prisma.$queryRaw`SELECT 1`)

  // ── Single pass: fetch WITH details (listing page has no city data) ──
  const targetCities = [...new Set(locations.map((l) => l.city?.toLowerCase().trim()).filter(Boolean))] as string[]
  console.log(`[Eventseye/Ingest] Scraping with details (targeting ${targetCities.length} cities)...`)
  const allEvents = await scrapeEventseye({
    withDetails: true,
    targetCities,
  })
  console.log(`[Eventseye/Ingest] ${allEvents.length} events scraped matching target cities`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    const cityMatch = ev.dates.find((d) => {
      const c = d.city?.toLowerCase().trim()
      return c ? cityLocMap.has(c) : false
    })
    if (!cityMatch) continue
    const c = cityMatch.city?.toLowerCase().trim()!
    const loc = cityLocMap.get(c)!

    const existing = await withRetry(() =>
      prisma.event.findFirst({
        where: {
          eventName: { equals: ev.title, mode: "insensitive" },
        },
      })
    )
    if (existing) {
      const newDesc = ev.description ?? null
      const existingMeta = (existing.metadata as Record<string, unknown>) ?? {}
      if (newDesc && !existingMeta.fullDescription) {
        await withRetry(() =>
          prisma.event.update({
            where: { id: existing.id },
            data: { metadata: { ...existingMeta, fullDescription: newDesc } },
          })
        )
      }
      continue
    }

    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    if (ev.dates && ev.dates.length > 0) {
      const parseDate = (text: string) => {
        const d = new Date(text)
        return isNaN(d.getTime()) ? null : d
      }
      eventDateStart = parseDate(ev.dates[0].dateText) ?? null
      if (ev.dates.length > 1) {
        eventDateEnd = parseDate(ev.dates[ev.dates.length - 1].dateText) ?? null
      }
    }

    if (dateFrom && eventDateStart && eventDateStart < dateFrom) continue
    if (dateTo && eventDateStart && eventDateStart > dateTo) continue

    const org = ev.organizerContact ?? null
    const hasContact = org && (org.name || org.email)

    // Match venue name if provided (Eventseye uses 'venues' array of objects)
    let rawVenueText: string | null = null
    let venueId: string | null = null
    let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"
    if (ev.venues && ev.venues.length > 0) {
      // venues is an array of objects, extract the name
      const venueName = typeof ev.venues[0] === 'string' ? ev.venues[0] : (ev.venues[0] as any).name
      if (venueName) {
        rawVenueText = venueName
        const venueMatch = matchVenue(venueName, loc.city, venueMap, venues)
        venueId = venueMatch.venueId
        matchType = venueMatch.matchType
      }
    }

    const event = await withRetry(() =>
      prisma.event.create({
        data: {
          locationId: loc.id,
          venueId: venueId ?? undefined,
          matchType,
          eventName: ev.title,
          eventDateStart,
          eventDateEnd,
          sourceUrl: ev.detailUrl ?? null,
          sourceSiteId,
          runId: runId ?? undefined,
          expectedAttendees: null,
          rawLocationText: cityMatch.city ?? null,
          rawVenueText,
          organizerName: org?.name ?? null,
          organizerEmail: org?.email ?? null,
          organizerPhone: org?.phone ?? null,
          metadata: ev.description ? { fullDescription: ev.description } : undefined,
        },
      })
    )
    totalNew++

    if (hasContact) {
      await withRetry(() =>
        prisma.eventContact.create({
          data: {
            eventId: event.id,
            name: org!.name ?? "",
            title: null,
            email: org!.email,
            phone: org!.phone,
            isPrimary: true,
            sourceUrl: ev.detailUrl ?? null,
            confidence: "medium",
          },
        })
      )
      console.log(`[Eventseye/Ingest] Saved contact for "${ev.title}"`)
    }
  }

  console.log(`[Eventseye/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Eventseye/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
