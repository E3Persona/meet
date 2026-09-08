import "dotenv/config"
import { scrapeEventsDcEvents } from "../lib/scrapers/eventsdc"
import { prisma, withRetry } from "@/lib/prisma"


const rawRunId = process.env.RUN_ID || null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[EventsDc/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()
  console.log(`[EventsDc/Ingest] runId=${runId ?? "none (will be saved without run association)"}`)

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "eventsdc" },
  })
  if (config?.active === false) {
    console.log("[EventsDc/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: "Walter E. Washington", mode: "insensitive" } },
          { name: { contains: "Walter Washington Convention", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: {
        OR: [
          { name: { contains: "eventsdc.com", mode: "insensitive" } },
          { url: { contains: "eventsdc.com", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.warn("[EventsDc/Ingest] No Walter E. Washington Convention Center found in DB — cannot associate events")
    return { recordsFound: 0, recordsNew: 0 }
  }

  // Prefer the location with city/state set
  const venueLocation = locations.find((l) => l.city) ?? locations[0]
  console.log(`[EventsDc/Ingest] Found venue: "${venueLocation.name}" (${venueLocation.city ?? "?"}, ${venueLocation.state ?? "?"}) id=${venueLocation.id}`)

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "EventsDC - Walter E. Washington Convention Center",
        url: "https://eventsdc.com/venue/walter-e-washington-convention-center/events-calendar",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
    sourceSiteId = created.id
    console.log(`[EventsDc/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0

  try {
    console.log(`[EventsDc/Ingest] Starting scrape...`)
    await withRetry(() => prisma.$queryRaw`SELECT 1`)
    const scrapeStart = Date.now()
    const events = await scrapeEventsDcEvents(18)
    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[EventsDc/Ingest] Scrape complete in ${scrapeDuration}s — ${events.length} total events`)

    for (const ev of events) {
      totalFound++

      const existing = await withRetry(() =>
        prisma.event.findFirst({
          where: {
            eventName: { equals: ev.eventName, mode: "insensitive" },
          },
        })
      )
      if (existing) {
        skippedDuplicate++
        console.log(`[EventsDc/Ingest] Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        continue
      }

      await withRetry(() =>
        prisma.event.create({
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
        })
      )
      totalNew++
      console.log(
        `[EventsDc/Ingest] ✓ Saved "${ev.eventName}"` +
          ` — venue="${ev.venue}" date=${ev.eventDateStart?.toISOString().slice(0, 10) ?? "unknown"}`
      )
    }
  } catch (err) {
    console.error("[EventsDc/Ingest] Error during scrape/ingest:", err)
  }

  console.log(`\n[EventsDc/Ingest] ═══════════════════════════════════════`)
  console.log(`[EventsDc/Ingest] SUMMARY`)
  console.log(`[EventsDc/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[EventsDc/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[EventsDc/Ingest]   New saved:        ${totalNew}`)
  console.log(`[EventsDc/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[EventsDc/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
