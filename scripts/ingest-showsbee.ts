import "dotenv/config"
import { scrapeShowsbee } from "../lib/scrapers/showsbee"
import { prisma, withRetry } from "../lib/prisma"
import { matchVenue, buildVenueMap } from "../lib/venueResolution"

const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "showsbee" },
  })
  return {
    maxPages: cfg?.maxPages ?? 3,
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

async function main() {
  console.log(`[Showsbee/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[Showsbee/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[Showsbee/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[Showsbee/Ingest] Config: maxPages=${config.maxPages}, maxLocations=${config.maxLocations}`)

  const [locations, venues, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true },
      take: config.maxLocations > 0 ? config.maxLocations : undefined,
      orderBy: { id: "asc" },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "showsbee.com" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[Showsbee/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null
  const locationCities = new Set(locations.map((l) => l.city?.toLowerCase().trim()))

  // Build venue name lookup for venue matching
  const venueMap = buildVenueMap(venues)

  // ── Pass 1: listing only ───────────────────────────────────────────────
  await withRetry(() => prisma.$queryRaw`SELECT 1`)
  console.log(`[Showsbee/Ingest] Pass 1: listing only (${locationCities.size} target cities)`)
  const allEvents = await scrapeShowsbee({
    category: "Professional_Shows",
    country: "United_States",
    city: "all_city",
    maxPages: config.maxPages,
    maxDetailPages: 0,
    withDetails: false,
  })

  const newCandidates: Array<{
    ev: (typeof allEvents)[number]
    loc: (typeof locations)[number]
    eventDateStart: Date | null
    eventDateEnd: Date | null
  }> = []

  for (const ev of allEvents) {
    const venueName = ev.venueName?.toLowerCase().trim() ?? ""
    const matchingLoc = locations.find((l) => {
      const lc = l.city?.toLowerCase().trim() ?? ""
      return venueName.includes(lc) || lc.includes(venueName)
    })
    if (!matchingLoc) continue

    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    if (ev.dateStart) {
      const d = new Date(ev.dateStart)
      if (!isNaN(d.getTime())) eventDateStart = d
    }
    if (ev.dateEnd) {
      const d = new Date(ev.dateEnd)
      if (!isNaN(d.getTime())) eventDateEnd = d
    }

    if (dateFrom && eventDateStart && eventDateStart < dateFrom) continue
    if (dateTo && eventDateStart && eventDateStart > dateTo) continue

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

    newCandidates.push({ ev, loc: matchingLoc, eventDateStart, eventDateEnd })
  }

  console.log(`[Showsbee/Ingest] Pass 1: ${allEvents.length} total scraped, ${newCandidates.length} are new`)

  if (newCandidates.length === 0) {
    return { recordsFound: 0, recordsNew: 0 }
  }

  // ── Pass 2: details for new events ───────────────────────────────────
  console.log(`[Showsbee/Ingest] Pass 2: fetching details for ${newCandidates.length} new events`)
  const detailedEvents = await scrapeShowsbee({
    category: "Professional_Shows",
    country: "United_States",
    city: "all_city",
    maxPages: config.maxPages,
    withDetails: true,
  })

  const detailMap = new Map(detailedEvents.map((ev) => [ev.detailUrl, ev]))

  let totalFound = newCandidates.length
  let totalNew = 0

  for (const { ev, loc, eventDateStart, eventDateEnd } of newCandidates) {
    const detail = detailMap.get(ev.detailUrl)
    const venueName = detail?.venues?.[0]?.name ?? ev.venueName
    // Match venue name if provided
    const venueMatch = matchVenue(venueName, loc.city, venueMap, venues)
    let venueId: string | null = venueMatch.venueId
    let matchType: import("../lib/generated/prisma/client").EventMatchType = venueMatch.matchType

    const org = detail?.organizerContact ?? ev.organizerContact
    const hasContact = org && (org.name || org.email)

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
          organizerName: org?.name ?? null,
          organizerEmail: org?.email ?? null,
          organizerPhone: org?.phone ?? null,
          rawLocationText: detail?.venues?.[0]?.address ?? ev.venueName ?? null,
          rawVenueText: venueId ? null : (venueName ?? null),
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
      console.log(`[Showsbee/Ingest] Saved contact for "${ev.title}"`)
    }
  }

  console.log(`[Showsbee/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Showsbee/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
