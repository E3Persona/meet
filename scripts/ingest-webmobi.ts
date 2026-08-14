import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { fetchWebmobiEvents } from "../lib/scrapers/webmobi"

const rawRunId = process.env.RUN_ID ?? null

const CITY_ALIASES: Record<string, string> = {
  "washington, d.c.": "Washington DC",
  "new york city": "New York",
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
  console.log(`[Webmobi/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "webmobi" },
  })
  if (config?.active === false) {
    console.log("[Webmobi/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: {
        OR: [
          { name: { contains: "webmobi", mode: "insensitive" } },
          { url: { contains: "webmobi.com", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ])

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "Webmobi Discovery",
        url: "https://www.webmobi.com/api/discovery/events?location=north-america",
        active: true,
        sourceMode: "automated",
        scrapeMode: "search",
      },
    })
    sourceSiteId = created.id
    console.log(`[Webmobi/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  // Build normalized city -> Location lookup
  const cityLocMap = new Map<string, typeof locations[number]>()
  for (const loc of locations) {
    const key = (loc.city ?? "").toLowerCase().trim()
    if (key) cityLocMap.set(key, loc)
    const nameKey = loc.name.toLowerCase().trim()
    if (nameKey) cityLocMap.set(nameKey, loc)
  }

  await withRetry(() => prisma.$queryRaw`SELECT 1`)
  console.log(`[Webmobi/Ingest] Fetching events from API...`)
  let events: Awaited<ReturnType<typeof fetchWebmobiEvents>>
  try {
    events = await fetchWebmobiEvents()
  } catch (err) {
    console.error("[Webmobi/Ingest] API fetch failed:", err)
    return { recordsFound: 0, recordsNew: 0 }
  }

  console.log(`[Webmobi/Ingest] ${events.length} US events from API`)

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedNoLocation = 0

  for (const ev of events) {
    totalFound++

    const rawCity = ev.city ? normalizeCity(ev.city) : null
    if (!rawCity) {
      skippedNoLocation++
      continue
    }

    const loc = cityLocMap.get(rawCity.toLowerCase())
    if (!loc) {
      skippedNoLocation++
      console.log(`[Webmobi/Ingest] Skip (no location match): "${ev.name}" city="${rawCity}"`)
      continue
    }

    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    if (ev.startDate) {
      const d = new Date(ev.startDate)
      if (!isNaN(d.getTime())) eventDateStart = d
    }
    if (ev.endDate) {
      const d = new Date(ev.endDate)
      if (!isNaN(d.getTime())) eventDateEnd = d
    }

    const existing = await withRetry(() =>
      prisma.event.findFirst({
        where: {
          eventName: { equals: ev.name, mode: "insensitive" },
        },
      })
    )
    if (existing) {
      skippedDuplicate++
      continue
    }

    await withRetry(() =>
      prisma.event.create({
        data: {
          locationId: loc.id,
          eventName: ev.name,
          eventDateStart,
          eventDateEnd,
          sourceUrl: ev.website_url ?? `https://www.webmobi.com/events/${ev.id}`,
          sourceSiteId,
          runId: runId ?? undefined,
          rawLocationText: rawCity,
          rawVenueText: null,
        },
      })
    )
    totalNew++
  }

  console.log(`\n[Webmobi/Ingest] ═══════════════════════════════════════`)
  console.log(`[Webmobi/Ingest] SUMMARY`)
  console.log(`[Webmobi/Ingest]   Total found:      ${totalFound}`)
  console.log(`[Webmobi/Ingest]   No location:      ${skippedNoLocation}`)
  console.log(`[Webmobi/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[Webmobi/Ingest]   New saved:        ${totalNew}`)
  console.log(`[Webmobi/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Webmobi/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
