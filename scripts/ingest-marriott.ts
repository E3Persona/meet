import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeMarriottLocalEvents } from "../lib/scrapers/marriott"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const rawRunId = process.env.RUN_ID ?? null

// Map location names (case-insensitive match by "contains") to Marriott property slugs.
// Property slugs are visible in the event.marriott.com URL for each hotel.
// To find a property slug, visit the hotel's page on marriott.com and check if
// https://event.marriott.com/{code}-{hotel-name}/events exists — the working slug is the path.
const MARRIOTT_PROPERTY_MAP: Record<string, string> = {
  "Bethesda North Marriott": "wasbt-bethesda-marriott",
  "Bethesda Marriott": "wasbt-bethesda-marriott",
}

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function findMatchingLocations(): Promise<Array<{ id: string; name: string; city: string | null; state: string | null; slug: string }>> {
  const all = await prisma.location.findMany({
    where: { active: true, type: "VENUE" },
    select: { id: true, name: true, city: true, state: true },
  })

  const matched: Array<{ id: string; name: string; city: string | null; state: string | null; slug: string }> = []
  for (const loc of all) {
    for (const [namePattern, slug] of Object.entries(MARRIOTT_PROPERTY_MAP)) {
      if (loc.name.toLowerCase().includes(namePattern.toLowerCase())) {
        matched.push({ ...loc, slug })
        break
      }
    }
  }
  return matched
}

async function main() {
  console.log(`[Marriott/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "marriott" },
  })
  if (config?.active === false) {
    console.log("[Marriott/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const matchedLocations = await findMatchingLocations()

  if (matchedLocations.length === 0) {
    console.warn("[Marriott/Ingest] No locations matched known Marriott property slugs")
    console.warn("[Marriott/Ingest] Add entries to MARRIOTT_PROPERTY_MAP in scripts/ingest-marriott.ts")
    return { recordsFound: 0, recordsNew: 0 }
  }

  console.log(`[Marriott/Ingest] Matched ${matchedLocations.length} location(s):`)
  for (const ml of matchedLocations) {
    console.log(`  → "${ml.name}" (${ml.city ?? "?"}, ${ml.state ?? "?"}) slug="${ml.slug}"`)
  }

  const existingSite = await prisma.sourceSite.findFirst({
    where: { name: { contains: "event.marriott.com", mode: "insensitive" } },
    select: { id: true },
  })
  let sourceSiteId = existingSite?.id ?? null
  if (!sourceSiteId) {
    const created = await prisma.sourceSite.create({
      data: {
        name: "Marriott Local Events",
        url: "https://event.marriott.com",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
    sourceSiteId = created.id
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedNoLocation = 0

  for (const ml of matchedLocations) {
    console.log(`\n[Marriott/Ingest] Scraping "${ml.slug}" for location "${ml.name}"...`)
    let events: Awaited<ReturnType<typeof scrapeMarriottLocalEvents>>
    try {
      events = await scrapeMarriottLocalEvents(ml.slug)
    } catch (err) {
      console.error(`[Marriott/Ingest] Scrape failed for "${ml.slug}":`, err)
      continue
    }

    console.log(`[Marriott/Ingest] ${events.length} raw events from "${ml.slug}"`)

    for (const ev of events) {
      totalFound++

      const existing = await prisma.event.findFirst({
        where: {
          eventName: { equals: ev.eventName, mode: "insensitive" },
          locationId: ml.id,
          eventDateStart: ev.eventDateStart ?? undefined,
        },
      })
      if (existing) {
        skippedDuplicate++
        continue
      }

      await prisma.event.create({
        data: {
          locationId: ml.id,
          eventName: ev.eventName,
          eventDateStart: ev.eventDateStart,
          eventDateEnd: ev.eventDateEnd,
          sourceUrl: ev.detailUrl,
          sourceSiteId,
          runId: runId ?? undefined,
          rawLocationText: ev.city && ev.state ? `${ev.city}, ${ev.state}` : null,
        },
      })
      totalNew++
    }
  }

  console.log(`\n[Marriott/Ingest] ═══════════════════════════════════════`)
  console.log(`[Marriott/Ingest] SUMMARY`)
  console.log(`[Marriott/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[Marriott/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[Marriott/Ingest]   No location:      ${skippedNoLocation}`)
  console.log(`[Marriott/Ingest]   New saved:        ${totalNew}`)
  console.log(`[Marriott/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Marriott/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
