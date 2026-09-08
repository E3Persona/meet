import "dotenv/config"
import { prisma, withRetry } from "@/lib/prisma"

import { scrapeGaylordNationalEvents } from "../lib/scrapers/gaylordnational"


const rawRunId = process.env.RUN_ID || null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[GaylordNational/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()
  console.log(`[GaylordNational/Ingest] runId=${runId ?? "none (will be saved without run association)"}`)

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "gaylordnational" },
  })
  if (config?.active === false) {
    console.log("[GaylordNational/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: "Gaylord National", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: {
        OR: [
          { name: { contains: "gaylordnational.com", mode: "insensitive" } },
          { url: { contains: "gaylordnational.com", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.warn("[GaylordNational/Ingest] No Gaylord National venue found in DB — cannot associate events")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const venueLocation = locations[0]
  console.log(`[GaylordNational/Ingest] Found venue: "${venueLocation.name}" (${venueLocation.city ?? "?"}, ${venueLocation.state ?? "?"}) id=${venueLocation.id}`)

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "Gaylord National Tickets",
        url: "https://tickets.gaylordnational.com/",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
    sourceSiteId = created.id
    console.log(`[GaylordNational/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0

  try {
    console.log(`[GaylordNational/Ingest] Starting scrape...`)
    await withRetry(() => prisma.$queryRaw`SELECT 1`)
    const scrapeStart = Date.now()
    const events = await scrapeGaylordNationalEvents()
    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[GaylordNational/Ingest] Scrape complete in ${scrapeDuration}s — ${events.length} total events`)

    for (const ev of events) {
      totalFound++

      const existing = await withRetry(() => prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
        },
      }))
      if (existing) {
        skippedDuplicate++
        console.log(`[GaylordNational/Ingest] Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
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
          rawVenueText: ev.venueName ?? null,
          rawLocationText: "National Harbor, MD",
        },
      }))
      totalNew++
      console.log(
        `[GaylordNational/Ingest] ✓ Saved "${ev.eventName}"` +
          ` — venue="${ev.venueName}" date=${ev.eventDateStart?.toISOString().slice(0, 10) ?? "unknown"}`
      )
    }
  } catch (err) {
    console.error("[GaylordNational/Ingest] Error during scrape/ingest:", err)
  }

  console.log(`\n[GaylordNational/Ingest] ═══════════════════════════════════════`)
  console.log(`[GaylordNational/Ingest] SUMMARY`)
  console.log(`[GaylordNational/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[GaylordNational/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[GaylordNational/Ingest]   New saved:        ${totalNew}`)
  console.log(`[GaylordNational/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[GaylordNational/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
