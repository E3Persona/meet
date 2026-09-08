import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { scrapePhillyExpoCenterEvents } from "../lib/scrapers/phillyexpocenter"

const rawRunId = process.env.RUN_ID || null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[PhillyExpoCenter/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()
  console.log(`[PhillyExpoCenter/Ingest] runId=${runId ?? "none (will be saved without run association)"}`)

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "phillyexpocenter" },
  })
  if (config?.active === false) {
    console.log("[PhillyExpoCenter/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: "Greater Philadelphia Expo Center", mode: "insensitive" } },
          { name: { contains: "Philly Expo Center", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: {
        OR: [
          { name: { contains: "phillyexpocenter.com", mode: "insensitive" } },
          { url: { contains: "phillyexpocenter.com", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.warn("[PhillyExpoCenter/Ingest] No Greater Philadelphia Expo Center at Oaks found in DB — cannot associate events")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const venueLocation = locations[0]
  console.log(`[PhillyExpoCenter/Ingest] Found venue: "${venueLocation.name}" (${venueLocation.city ?? "?"}, ${venueLocation.state ?? "?"}) id=${venueLocation.id}`)

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "Philly Expo Center Calendar",
        url: "https://phillyexpocenter.com/calendar/",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
    sourceSiteId = created.id
    console.log(`[PhillyExpoCenter/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0

  try {
    await withRetry(() => prisma.$queryRaw`SELECT 1`)
    console.log(`[PhillyExpoCenter/Ingest] Starting scrape...`)
    const scrapeStart = Date.now()
    const events = await scrapePhillyExpoCenterEvents()
    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[PhillyExpoCenter/Ingest] Scrape complete in ${scrapeDuration}s — ${events.length} total events`)

    for (const ev of events) {
      totalFound++

      const existing = await withRetry(() => prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
        },
      }))
      if (existing) {
        skippedDuplicate++
        console.log(`[PhillyExpoCenter/Ingest] Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        continue
      }

      await withRetry(() => prisma.event.create({
        data: {
          locationId: venueLocation.id,
          eventName: ev.eventName,
          eventDateStart: ev.eventDateStart,
          eventDateEnd: ev.eventDateEnd,
          sourceUrl: ev.detailUrl,
          sourceSiteId,
          runId: runId ?? undefined,
          rawVenueText: "Greater Philadelphia Expo Center",
          rawLocationText: "Oaks, PA",
        },
      }))
      totalNew++
      console.log(
        `[PhillyExpoCenter/Ingest] ✓ Saved "${ev.eventName}"` +
          ` — date=${ev.eventDateStart?.toISOString().slice(0, 10) ?? "unknown"}`
      )
    }
  } catch (err) {
    console.error("[PhillyExpoCenter/Ingest] Error during scrape/ingest:", err)
  }

  console.log(`\n[PhillyExpoCenter/Ingest] ═══════════════════════════════════════`)
  console.log(`[PhillyExpoCenter/Ingest] SUMMARY`)
  console.log(`[PhillyExpoCenter/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[PhillyExpoCenter/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[PhillyExpoCenter/Ingest]   New saved:        ${totalNew}`)
  console.log(`[PhillyExpoCenter/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[PhillyExpoCenter/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
