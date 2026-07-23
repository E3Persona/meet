import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapePhiladelphiaUnionEvents } from "../lib/scrapers/philadelphiaunion"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const rawRunId = process.env.RUN_ID ?? null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[PhiladelphiaUnion/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()
  console.log(`[PhiladelphiaUnion/Ingest] runId=${runId ?? "none (will be saved without run association)"}`)

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "philadelphiaunion" },
  })
  if (config?.active === false) {
    console.log("[PhiladelphiaUnion/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, existingSite] = await Promise.all([
    prisma.location.findMany({
      where: {
        active: true,
        OR: [
          { name: { contains: "Subaru Park", mode: "insensitive" } },
          { name: { contains: "Subaru", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: {
        OR: [
          { name: { contains: "philadelphiaunion.com", mode: "insensitive" } },
          { url: { contains: "philadelphiaunion.com", mode: "insensitive" } },
        ],
      },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.warn("[PhiladelphiaUnion/Ingest] No Subaru Park location found in DB — cannot associate events")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const venueLocation = locations[0]
  console.log(`[PhiladelphiaUnion/Ingest] Found venue: "${venueLocation.name}" (${venueLocation.city ?? "?"}, ${venueLocation.state ?? "?"}) id=${venueLocation.id}`)

  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "Philadelphia Union - Subaru Park Events",
        url: "https://www.philadelphiaunion.com/stadium/non-philadelphia-union-events",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
    sourceSiteId = created.id
    console.log(`[PhiladelphiaUnion/Ingest] Created sourceSite id=${sourceSiteId}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0

  try {
    console.log(`[PhiladelphiaUnion/Ingest] Starting scrape...`)
    const scrapeStart = Date.now()
    const events = await scrapePhiladelphiaUnionEvents()
    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[PhiladelphiaUnion/Ingest] Scrape complete in ${scrapeDuration}s — ${events.length} total events`)

    for (const ev of events) {
      totalFound++

      const existing = await prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
          locationId: venueLocation.id,
          eventDateStart: ev.eventDateStart ?? undefined,
        },
      })
      if (existing) {
        skippedDuplicate++
        console.log(`[PhiladelphiaUnion/Ingest] Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        continue
      }

      await prisma.event.create({
        data: {
          locationId: venueLocation.id,
          eventName: ev.eventName,
          eventDateStart: ev.eventDateStart,
          eventDateEnd: ev.eventDateEnd,
          sourceUrl: ev.sourceUrl,
          sourceSiteId,
          runId: runId ?? undefined,
        },
      })
      totalNew++
      console.log(
        `[PhiladelphiaUnion/Ingest] ✓ Saved "${ev.eventName}"` +
          ` — venue="${ev.venue}" date=${ev.eventDateStart?.toISOString().slice(0, 10) ?? "unknown"}`
      )
    }
  } catch (err) {
    console.error("[PhiladelphiaUnion/Ingest] Error during scrape/ingest:", err)
  }

  console.log(`\n[PhiladelphiaUnion/Ingest] ═══════════════════════════════════════`)
  console.log(`[PhiladelphiaUnion/Ingest] SUMMARY`)
  console.log(`[PhiladelphiaUnion/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[PhiladelphiaUnion/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[PhiladelphiaUnion/Ingest]   New saved:        ${totalNew}`)
  console.log(`[PhiladelphiaUnion/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[PhiladelphiaUnion/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
