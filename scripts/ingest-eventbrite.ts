import "dotenv/config"
import { prisma } from "../lib/prisma"
import { createEventbriteBrowser, matchEventsToVenue, scrapeSearchPage } from "../lib/scrapers/eventbrite"

const rawRunId = process.env.RUN_ID ?? null

async function resolveRunId(): Promise<string | undefined> {
  if (!rawRunId) return undefined
  const row = await prisma.ingestionRun.findUnique({ where: { id: rawRunId }, select: { id: true } })
  return row?.id ?? undefined
}

async function main() {
  console.log(`[Eventbrite/Ingest] Starting at ${new Date().toISOString()}`)

  const runId = await resolveRunId()

  const config = await prisma.ingestConfig.findUnique({
    where: { scraper: "eventbrite" },
  })
  if (config?.active === false) {
    console.log("[Eventbrite/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const venues = await prisma.location.findMany({
    where: { active: true, type: "VENUE" },
    select: { id: true, name: true, city: true, state: true },
  })
  console.log(`[Eventbrite/Ingest] Found ${venues.length} active VENUE locations`)

  let sourceSite = await prisma.sourceSite.findFirst({ where: { name: "Eventbrite" } })
  if (!sourceSite) {
    sourceSite = await prisma.sourceSite.create({
      data: {
        name: "Eventbrite",
        url: "https://www.eventbrite.com",
        active: true,
        sourceMode: "automated",
        scrapeMode: "calendar",
      },
    })
  }

  // Group venues by (city, state)
  const cityGroups = new Map<string, typeof venues>()
  for (const v of venues) {
    if (!v.city || !v.state) continue
    const key = `${v.city}|${v.state}`
    if (!cityGroups.has(key)) cityGroups.set(key, [])
    cityGroups.get(key)!.push(v)
  }
  console.log(`[Eventbrite/Ingest] Grouped into ${cityGroups.size} city/state groups`)

  let browser: Awaited<ReturnType<typeof createEventbriteBrowser>>
  try {
    browser = await createEventbriteBrowser()
  } catch (err) {
    console.error("[Eventbrite/Ingest] Failed to launch browser:", err)
    return { recordsFound: 0, recordsNew: 0 }
  }
  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let groupIndex = 0

  try {
    for (const [key, cityVenues] of cityGroups) {
      groupIndex++
      const [city, state] = key.split("|")
      console.log(`\n[Eventbrite/Ingest] [${groupIndex}/${cityGroups.size}] Searching ${city}, ${state} (${cityVenues.length} venues)...`)

      let rawEvents: Awaited<ReturnType<typeof scrapeSearchPage>> = []
      try {
        const page = await browser.newPage()
        await page.setViewport({ width: 1920, height: 1080 })
        rawEvents = await scrapeSearchPage(`${city} ${state} events`, page)
        await page.close().catch(() => {})
      } catch (err) {
        console.error(`[Eventbrite/Ingest]   Error searching ${city}:`, (err as any)?.message?.slice(0, 100) || err)
        continue
      }
      console.log(`[Eventbrite/Ingest]   ${rawEvents.length} total events in ${city}`)

      for (const v of cityVenues) {
        const matched = matchEventsToVenue(rawEvents, v.name, city, state)
        if (matched.length === 0) continue

        console.log(`[Eventbrite/Ingest]   → "${v.name}": ${matched.length} events`)
        for (const ev of matched) {
          totalFound++

          const existing = await prisma.event.findFirst({
            where: {
              eventName: { equals: ev.eventName, mode: "insensitive" },
            },
          })
          if (existing) {
            skippedDuplicate++
            continue
          }

          await prisma.event.create({
            data: {
              locationId: v.id,
              eventName: ev.eventName,
              eventDateStart: ev.eventDateStart ? new Date(ev.eventDateStart) : null,
              eventDateEnd: ev.eventDateEnd ? new Date(ev.eventDateEnd) : null,
              sourceUrl: ev.detailUrl,
              sourceSiteId: sourceSite.id,
              runId: runId ?? undefined,
              rawVenueText: ev.venueName,
              rawLocationText: ev.venueCity && ev.venueState ? `${ev.venueCity}, ${ev.venueState}` : null,
            },
          })
          totalNew++
        }
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  console.log(`\n[Eventbrite/Ingest] ═══════════════════════════════════════`)
  console.log(`[Eventbrite/Ingest] SUMMARY`)
  console.log(`[Eventbrite/Ingest]   Venues:           ${venues.length}`)
  console.log(`[Eventbrite/Ingest]   City groups:      ${cityGroups.size}`)
  console.log(`[Eventbrite/Ingest]   Total found:      ${totalFound}`)
  console.log(`[Eventbrite/Ingest]   New saved:        ${totalNew}`)
  console.log(`[Eventbrite/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[Eventbrite/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[Eventbrite/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
