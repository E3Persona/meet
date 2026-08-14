import "dotenv/config"

import { prisma } from "../lib/prisma"
import { scrapeTradeFairDatesEvents, enrichTradeFairDateEvent } from "../lib/scrapers/tradefairdates"


const rawRunId = process.env.RUN_ID ?? null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ")
}

async function main() {
  console.log(`[TradeFairDates/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()
  console.log(`[TradeFairDates/Ingest] runId=${runId ?? "none"}`)

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "tradefairdates" },
  })
  if (config?.active === false) {
    console.log("[TradeFairDates/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  // Load all active locations for city matching
  const [locations, venues] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true, state: true },
    }),
  ])
  console.log(`[TradeFairDates/Ingest] Loaded ${locations.length} active locations, ${venues.length} active venues`)

  if (locations.length === 0) {
    console.log("[TradeFairDates/Ingest] No active locations — nothing to do")
    return { recordsFound: 0, recordsNew: 0 }
  }

  // Build city lookup: normalized city -> location IDs
  const cityMap = new Map<string, { locationIds: string[]; cities: string[] }>()
  for (const loc of locations) {
    const city = loc.city?.trim()
    if (!city) continue
    const key = norm(city)
    if (!cityMap.has(key)) {
      cityMap.set(key, { locationIds: [], cities: [] })
    }
    cityMap.get(key)!.locationIds.push(loc.id)
    if (!cityMap.get(key)!.cities.includes(city)) {
      cityMap.get(key)!.cities.push(city)
    }
  }

  // Build venue name lookup for venue matching
  const venueMap = new Map<string, typeof venues[number]>()
  for (const venue of venues) {
    const key = venue.name.toLowerCase()
    venueMap.set(key, venue)
  }

  // Also try matching by location name (some locations are venues named after a city area)
  const nameMap = new Map<string, string[]>()
  for (const loc of locations) {
    if (loc.name) {
      const key = norm(loc.name)
      if (!nameMap.has(key)) nameMap.set(key, [])
      nameMap.get(key)!.push(loc.id)
    }
  }

  console.log(`[TradeFairDates/Ingest] ${cityMap.size} unique cities in DB`)

  // Find/create source site
  const existingSite = await prisma.sourceSite.findFirst({
    where: {
      OR: [
        { name: { contains: "tradefairdates.com", mode: "insensitive" } },
        { url: { contains: "tradefairdates.com", mode: "insensitive" } },
      ],
    },
    select: { id: true },
  })

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "TradeFairDates - USA",
        url: "https://www.tradefairdates.com/Fairs-USA-Z228-S1.html",
        active: true,
        sourceMode: "automated",
        scrapeMode: "directory",
      },
    })
    sourceSiteId = created.id
    console.log(`[TradeFairDates/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedNoCity = 0

  try {
    console.log(`[TradeFairDates/Ingest] Starting scrape...`)
    const scrapeStart = Date.now()

    // Phase 1: scrape listing only (no detail pages yet)
    const allEvents = await scrapeTradeFairDatesEvents()
    const scrapeDuration1 = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[TradeFairDates/Ingest] Listing scrape in ${scrapeDuration1}s — ${allEvents.length} total events`)

    // Phase 2: filter to cities that match our DB
    interface MatchEntry { ev: typeof allEvents[number]; locId: string }
    const matched: MatchEntry[] = []
    for (const ev of allEvents) {
      const cityKey = ev.city ? norm(ev.city) : null
      const match = cityKey ? cityMap.get(cityKey) : undefined
      if (match) matched.push({ ev, locId: match.locationIds[0] })
      else skippedNoCity++
    }
    console.log(`[TradeFairDates/Ingest] ${matched.length} events match DB cities (${skippedNoCity} skipped)`)

    // Phase 3: enrich only matched events with contact details
    const enrichStart = Date.now()
    for (let i = 0; i < matched.length; i++) {
      matched[i].ev = await enrichTradeFairDateEvent(matched[i].ev)
      if ((i + 1) % 5 === 0) {
        console.log(`[TradeFairDates/Ingest] Enriched ${i + 1}/${matched.length} matched events`)
      }
    }
    const enrichDuration = ((Date.now() - enrichStart) / 1000).toFixed(1)
    console.log(`[TradeFairDates/Ingest] Enrichment done in ${enrichDuration}s`)

    const totalDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[TradeFairDates/Ingest] Total scrape+enrich in ${totalDuration}s`)

    for (const { ev, locId } of matched) {
      totalFound++

      // TradeFairDates scraper doesn't provide venue names, so we only match at city level
      let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"

      // Deduplicate
      const existing = await prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
        },
      })
      if (existing) {
        skippedDuplicate++
        console.log(`[TradeFairDates/Ingest] Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        const newDesc = ev.description ?? null
        const existingMeta = (existing.metadata as Record<string, unknown>) ?? {}
        if (newDesc && !existingMeta.fullDescription) {
          await prisma.event.update({
            where: { id: existing.id },
            data: { metadata: { ...existingMeta, fullDescription: newDesc } },
          })
        }
        continue
      }

      await prisma.event.create({
        data: {
          locationId: locId,
          matchType,
          eventName: ev.eventName,
          eventDateStart: ev.eventDateStart,
          eventDateEnd: ev.eventDateEnd,
          sourceUrl: ev.detailUrl,
          organizerEmail: ev.contactEmail,
          organizerName: ev.websiteUrl,
          sourceSiteId,
          runId: runId ?? undefined,
          rawLocationText: ev.city,
          rawVenueText: ev.venueName ?? null,
          metadata: ev.description ? { fullDescription: ev.description } : undefined,
        },
      })
      totalNew++
      console.log(
        `[TradeFairDates/Ingest] ✓ Saved "${ev.eventName}"` +
          ` — city="${ev.city}" date=${ev.eventDateStart?.toISOString().slice(0, 10) ?? "unknown"}` +
          (ev.contactEmail ? ` email=${ev.contactEmail}` : "")
      )
    }
  } catch (err) {
    console.error("[TradeFairDates/Ingest] Error during scrape/ingest:", err)
  }

  console.log(`\n[TradeFairDates/Ingest] ═══════════════════════════════════════`)
  console.log(`[TradeFairDates/Ingest] SUMMARY`)
  console.log(`[TradeFairDates/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[TradeFairDates/Ingest]   No city match:    ${skippedNoCity}`)
  console.log(`[TradeFairDates/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[TradeFairDates/Ingest]   New saved:        ${totalNew}`)
  console.log(`[TradeFairDates/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[TradeFairDates/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
