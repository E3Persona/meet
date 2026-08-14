import "dotenv/config"

import {
  createBigEventBrowser,
  scrapeBigEventEvents,
  type BigEventEvent,
} from "../lib/scrapers/bigevent"
import { prisma, withRetry } from "../lib/prisma"

const rawRunId = process.env.RUN_ID ?? null

const CITY_ALIASES: Record<string, string> = {
  "new york city": "New York",
  "washington, d.c.": "Washington DC",
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
  console.log(`[BigEvent/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "bigevent" },
  })
  if (config?.active === false) {
    console.log("[BigEvent/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "BigEvent.io" },
      select: { id: true },
    }),
  ])

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "BigEvent.io",
        url: "https://bigevent.io",
        active: true,
        sourceMode: "automated",
        scrapeMode: "directory",
      },
    })
    sourceSiteId = created.id
    console.log(`[BigEvent/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  const cityLocMap = new Map<string, typeof locations[number]>()
  for (const loc of locations) {
    const key = (loc.city ?? "").toLowerCase().trim()
    if (key) cityLocMap.set(key, loc)
  }

  // Step 1: Scrape events
  let browser: Awaited<ReturnType<typeof createBigEventBrowser>>
  try {
    browser = await createBigEventBrowser()
  } catch (err) {
    console.error("[BigEvent/Ingest] Failed to launch browser:", err)
    return { recordsFound: 0, recordsNew: 0 }
  }

  await withRetry(() => prisma.$queryRaw`SELECT 1`)

  let rawEvents: BigEventEvent[]
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })
    rawEvents = await scrapeBigEventEvents(page)
    await page.close().catch(() => {})
  } catch (err) {
    console.error("[BigEvent/Ingest] Scraping failed:", err)
    await browser.close().catch(() => {})
    return { recordsFound: 0, recordsNew: 0 }
  } finally {
    await browser.close().catch(() => {})
  }

  console.log(`[BigEvent/Ingest] Raw events: ${rawEvents.length}`)

  // Step 2: Filter to USA events
  const usaEvents = rawEvents.filter((ev) => {
    if (!ev.country) return false
    return ev.country.toLowerCase() === "united states"
  })
  console.log(`[BigEvent/Ingest] USA events: ${usaEvents.length}`)

  // Step 3: Match, dedup, save
  let totalFound = 0
  let totalNew = 0
  let skippedNoLocation = 0
  let skippedDuplicate = 0

  for (const ev of usaEvents) {
    totalFound++

    if (!ev.city) {
      skippedNoLocation++
      continue
    }

    const rawCity = normalizeCity(ev.city)
    const loc = cityLocMap.get(rawCity.toLowerCase())
    if (!loc) {
      skippedNoLocation++
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

    const existing = await withRetry(() => prisma.event.findFirst({
      where: {
        eventName: { equals: ev.name, mode: "insensitive" },
      },
    }))
    if (existing) {
      skippedDuplicate++
      continue
    }

    const rawLocationText = ev.city
      ? `${ev.city}, United States`
      : null

    await withRetry(() => prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.name,
        eventDateStart,
        eventDateEnd,
        sourceUrl: ev.website,
        sourceSiteId,
        runId: runId ?? undefined,
        rawVenueText: ev.venue || null,
        rawLocationText,
      },
    }))
    totalNew++
  }

  console.log(`\n[BigEvent/Ingest] ═══════════════════════════════════════`)
  console.log(`[BigEvent/Ingest] SUMMARY`)
  console.log(`[BigEvent/Ingest]   Raw events:       ${rawEvents.length}`)
  console.log(`[BigEvent/Ingest]   USA events:       ${usaEvents.length}`)
  console.log(`[BigEvent/Ingest]   No location:      ${skippedNoLocation}`)
  console.log(`[BigEvent/Ingest]   Duplicates:        ${skippedDuplicate}`)
  console.log(`[BigEvent/Ingest]   New saved:         ${totalNew}`)
  console.log(`[BigEvent/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[BigEvent/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
