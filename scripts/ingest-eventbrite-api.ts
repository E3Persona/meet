import "dotenv/config"

import { createEventbriteBrowser, scrapeSearchPage } from "../lib/scrapers/eventbrite"
import { discoverEvents, type EventbriteApiEvent } from "../lib/scrapers/eventbrite-api"
import { prisma, withRetry } from "../lib/prisma"

const rawRunId = process.env.RUN_ID ?? null

const CITY_ALIASES: Record<string, string> = {
  "washington, d.c.": "Washington DC",
  "new york city": "New York",
  "st. louis": "St Louis",
}

function normalizeCity(raw: string): string {
  const lower = raw.trim().toLowerCase()
  return CITY_ALIASES[lower] ?? raw.trim()
}

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[EventbriteAPI/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "eventbrite-api" },
  })
  if (config?.active === false) {
    console.log("[EventbriteAPI/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "Eventbrite API" },
      select: { id: true },
    }),
  ])

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "Eventbrite",
        url: "https://www.eventbrite.com",
        active: true,
        sourceMode: "automated",
        scrapeMode: "search",
      },
    })
    sourceSiteId = created.id
    console.log(`[EventbriteAPI/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  // Build normalized city -> Location lookup
  const cityLocMap = new Map<string, typeof locations[number]>()
  for (const loc of locations) {
    const key = (loc.city ?? "").toLowerCase().trim()
    if (key) cityLocMap.set(key, loc)
  }

  // Step 1: Get initial event IDs from search pages
  const searchCities = new Set<string>()
  for (const loc of locations) {
    if (loc.city && loc.state) searchCities.add(`${loc.city}|${loc.state}`)
  }

  await withRetry(() => prisma.$queryRaw`SELECT 1`)

  console.log(`[EventbriteAPI/Ingest] Step 1: Searching ${searchCities.size} city/state groups for seed event IDs...`)

  let browser: Awaited<ReturnType<typeof createEventbriteBrowser>>
  try {
    browser = await createEventbriteBrowser()
  } catch (err) {
    console.error("[EventbriteAPI/Ingest] Failed to launch browser:", err)
    return { recordsFound: 0, recordsNew: 0 }
  }

  const seedIds = new Set<string>()
  try {
    for (const key of searchCities) {
      const [city, state] = key.split("|")
      try {
        const page = await browser.newPage()
        await page.setViewport({ width: 1920, height: 1080 })
        const rawEvents = await scrapeSearchPage(`${city} ${state} events`, page)
        await page.close().catch(() => {})

        for (const r of rawEvents) {
          if (!r.is_online_event && !r.is_livestream) {
            seedIds.add(String(r.id))
          }
        }
        console.log(`[EventbriteAPI/Ingest]   ${city}, ${state}: ${rawEvents.length} events, ${seedIds.size} unique IDs so far`)
      } catch (err) {
        console.warn(`  Search failed for ${city}:`, (err as any)?.message?.slice(0, 80))
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  if (seedIds.size === 0) {
    console.log("[EventbriteAPI/Ingest] No seed event IDs found from search")
    return { recordsFound: 0, recordsNew: 0 }
  }

  console.log(`\n[EventbriteAPI/Ingest] Step 2: Enriching ${seedIds.size} seed IDs via API + discovering collections...`)

  // Step 2: Use API to enrich + discover
  const seedArray = [...seedIds]
  let apiEvents: EventbriteApiEvent[]
  try {
    apiEvents = await discoverEvents(seedArray, 3, 2000)
  } catch (err) {
    console.error("[EventbriteAPI/Ingest] API enrichment failed:", err)
    return { recordsFound: seedArray.length, recordsNew: 0 }
  }

  console.log(`[EventbriteAPI/Ingest] API returned ${apiEvents.length} total events`)

  // Step 3: Match & save
  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedNoLocation = 0
  let skippedOnline = 0

  for (const ev of apiEvents) {
    totalFound++

    if (ev.isOnline) {
      skippedOnline++
      continue
    }
    if (!ev.venue || !ev.venue.city) {
      skippedNoLocation++
      continue
    }

    const rawCity = normalizeCity(ev.venue.city)
    const loc = cityLocMap.get(rawCity.toLowerCase())
    if (!loc) {
      skippedNoLocation++
      continue
    }

    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    if (ev.startDate) {
      const d = ev.startTime
        ? new Date(`${ev.startDate}T${ev.startTime}`)
        : new Date(ev.startDate)
      if (!isNaN(d.getTime())) eventDateStart = d
    }
    if (ev.endDate) {
      const d = ev.endTime
        ? new Date(`${ev.endDate}T${ev.endTime}`)
        : new Date(ev.endDate)
      if (!isNaN(d.getTime())) eventDateEnd = d
    }

    const existing = await withRetry(() => prisma.event.findFirst({
      where: {
        eventName: { equals: ev.name, mode: "insensitive" },
      },
    }))
    if (existing) {
      skippedDuplicate++
      continue
    }

    const rawLocationText = ev.venue.city && ev.venue.region
      ? `${ev.venue.city}, ${ev.venue.region}`
      : ev.venue.city ?? null

    await withRetry(() => prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.name,
        eventDateStart,
        eventDateEnd,
        sourceUrl: ev.url,
        sourceSiteId,
        runId: runId ?? undefined,
        rawVenueText: ev.venue.name,
        rawLocationText,
      },
    }))
    totalNew++
  }

  console.log(`\n[EventbriteAPI/Ingest] ═══════════════════════════════════════`)
  console.log(`[EventbriteAPI/Ingest] SUMMARY`)
  console.log(`[EventbriteAPI/Ingest]   Seed IDs:         ${seedIds.size}`)
  console.log(`[EventbriteAPI/Ingest]   API total:         ${apiEvents.length}`)
  console.log(`[EventbriteAPI/Ingest]   Online filtered:   ${skippedOnline}`)
  console.log(`[EventbriteAPI/Ingest]   No location:      ${skippedNoLocation}`)
  console.log(`[EventbriteAPI/Ingest]   Duplicates:        ${skippedDuplicate}`)
  console.log(`[EventbriteAPI/Ingest]   New saved:         ${totalNew}`)
  console.log(`[EventbriteAPI/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[EventbriteAPI/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
