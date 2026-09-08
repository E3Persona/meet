import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { scrapeRrbitcEvents } from "../lib/scrapers/rrbitc"


const rawRunId = process.env.RUN_ID || null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[Rrbitc/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()
  console.log(`[Rrbitc/Ingest] runId=${runId ?? "none (will be saved without run association)"}`)

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "rrbitc" },
  })
  if (config?.active === false) {
    console.log("[Rrbitc/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: "Ronald Reagan", mode: "insensitive" } },
          { name: { contains: "Reagan", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: {
        OR: [
          { name: { contains: "rrbitc.com", mode: "insensitive" } },
          { url: { contains: "rrbitc.com", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.warn("[Rrbitc/Ingest] No Ronald Reagan Building location found in DB — cannot associate events")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const venueLocation = locations[0]
  console.log(`[Rrbitc/Ingest] Found venue: "${venueLocation.name}" (${venueLocation.city ?? "?"}, ${venueLocation.state ?? "?"}) id=${venueLocation.id}`)

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "RRBITC - Ronald Reagan Building Events Calendar",
        url: "https://rrbitc.com/events-calendar/",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
    sourceSiteId = created.id
    console.log(`[Rrbitc/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0

  try {
    console.log(`[Rrbitc/Ingest] Starting scrape...`)
    await withRetry(() => prisma.$queryRaw`SELECT 1`)
    const scrapeStart = Date.now()
    const events = await scrapeRrbitcEvents()
    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[Rrbitc/Ingest] Scrape complete in ${scrapeDuration}s — ${events.length} total events`)

    for (const ev of events) {
      totalFound++

      const existing = await withRetry(() => prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
        },
      }))
      if (existing) {
        skippedDuplicate++
        console.log(`[Rrbitc/Ingest] Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        continue
      }

      await withRetry(() => prisma.event.create({
        data: {
          locationId: venueLocation.id,
          eventName: ev.eventName,
          eventDateStart: ev.eventDateStart,
          eventDateEnd: ev.eventDateEnd,
          sourceUrl: ev.sourceUrl,
          sourceSiteId,
          runId: runId ?? undefined,
          rawVenueText: ev.venue ?? null,
          rawLocationText: "Washington, DC",
        },
      }))
      totalNew++
      console.log(
        `[Rrbitc/Ingest] ✓ Saved "${ev.eventName}"` +
          ` — venue="${ev.venue}" date=${ev.eventDateStart?.toISOString().slice(0, 10) ?? "unknown"}`
      )
    }
  } catch (err) {
    console.error("[Rrbitc/Ingest] Error during scrape/ingest:", err)
  }

  console.log(`\n[Rrbitc/Ingest] ═══════════════════════════════════════`)
  console.log(`[Rrbitc/Ingest] SUMMARY`)
  console.log(`[Rrbitc/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[Rrbitc/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[Rrbitc/Ingest]   New saved:        ${totalNew}`)
  console.log(`[Rrbitc/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Rrbitc/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
