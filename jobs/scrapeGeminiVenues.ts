import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeViaLocationSearch, type GeminiParsedEvent, type GeminiRawBlock } from "../lib/geminiScraper"
import { hashContent } from "../lib/scrape/blockSplitter"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const LOCATION_SEARCH_INTERVAL_DAYS = parseInt(
  process.env.GEMINI_LOCATION_SEARCH_INTERVAL_DAYS ?? "7",
)

async function main() {
  const parentRunId = process.env.RUN_ID ?? null

  const ingestionRun = await prisma.ingestionRun.create({
    data: {
      trigger: process.env.CRON ? "scheduled" : "manual",
      status: "running",
      providersUsed: { gemini: "location_search" },
    },
  })

  const eventRunId = parentRunId && parentRunId.length > 20 ? parentRunId : ingestionRun.id

  console.log(`[scrapeGeminiVenues] Run ${ingestionRun.id} started (events use=${eventRunId})`)

  const sources = (await prisma.venueDirectorySource.findMany({
    where: {
      isActive: true,
      strategy: "gemini_location_search",
      OR: [{ nextCheckAt: { lte: new Date() } }, { nextCheckAt: null }],
    },
    include: {
      directory: { select: { baseUrl: true, type: true } },
      venue: { select: { id: true, name: true, city: true, state: true } },
    },
    take: parseInt(process.env.GEMINI_BATCH_SIZE ?? "5"),
  }))

  console.log(`[scrapeGeminiVenues] ${sources.length} sources due for Gemini search`)

  let totalFound = 0
  let totalNew = 0
  let totalSkipped = 0
  let totalErrors = 0
  let totalSearchQueries = 0

  for (const source of sources) {
    const venueName = source.venue.name
    const city = source.venue.city ?? ""
    const state = source.venue.state ?? ""
    console.log(`\n[scrapeGeminiVenues] Searching for events at ${venueName} (${city}, ${state})`)

    try {
      const result = await scrapeViaLocationSearch({
        id: source.venue.id,
        name: venueName,
        city,
        state,
        directoryId: source.directoryId,
      })

      totalSearchQueries += result.searchQueries.length

      if (result.events.length === 0) {
        console.log(`[scrapeGeminiVenues]   No events found by Gemini`)
        await updateSourceCheck(source.id, false)
        continue
      }

      console.log(`[scrapeGeminiVenues]   Gemini returned ${result.events.length} event(s)`)
      if (result.searchQueries.length > 0) {
        console.log(`[scrapeGeminiVenues]   Search queries: ${result.searchQueries.join(", ")}`)
      }
      if (result.usage) {
        console.log(`[scrapeGeminiVenues]   Usage: ${JSON.stringify(result.usage)}`)
      }

      const { newEvents, skipped, found } = await saveEvents(
        prisma,
        source,
        result.events,
        result.rawBlocks,
        eventRunId,
      )

      totalFound += found
      totalNew += newEvents
      totalSkipped += skipped

      await updateSourceCheck(source.id, true)

    } catch (err) {
      totalErrors++
      console.error(`[scrapeGeminiVenues] Error for ${venueName}:`, err instanceof Error ? err.message : err)
    }
  }

  await prisma.ingestionRun.update({
    where: { id: ingestionRun.id },
    data: {
      status: totalErrors === sources.length && sources.length > 0 ? "failed" : "success",
      finishedAt: new Date(),
      recordsFound: totalFound,
      recordsNew: totalNew,
    },
  })

  console.log(`\n[scrapeGeminiVenues] ═════════════════════════════════════════`)
  console.log(`[scrapeGeminiVenues]  Run ${ingestionRun.id} complete`)
  console.log(`[scrapeGeminiVenues]   Found:       ${totalFound}`)
  console.log(`[scrapeGeminiVenues]   New:         ${totalNew}`)
  console.log(`[scrapeGeminiVenues]   Skipped:     ${totalSkipped}`)
  console.log(`[scrapeGeminiVenues]   SearchQueries: ${totalSearchQueries}`)
  console.log(`[scrapeGeminiVenues]   Errors:      ${totalErrors}`)
  console.log(`[scrapeGeminiVenues] ═════════════════════════════════════════\n`)
}

async function saveEvents(
  prisma: PrismaClient,
  source: {
    id: string
    venueId: string
    venue: { id: string; name: string; city: string | null; state: string | null }
  },
  events: GeminiParsedEvent[],
  rawBlocks: GeminiRawBlock[],
  runId: string,
): Promise<{ newEvents: number; skipped: number; found: number }> {
  const existingBlocks = await prisma.seenBlock.findMany({
    where: { sourceId: source.id },
    select: { blockHash: true, identityKey: true },
  })
  const existingBlockHashes = new Set(existingBlocks.map((b) => b.blockHash))

  // Find the city location for this venue
  const cityLocation = await prisma.location.findFirst({
    where: {
      type: "CITY",
      city: source.venue.city,
      state: source.venue.state,
      active: true,
    },
  })

  if (!cityLocation) {
    console.error(`[scrapeGeminiVenues] No city location found for venue ${source.venue.name} (${source.venue.city}, ${source.venue.state})`)
    return { newEvents: 0, skipped: events.length, found: events.length }
  }

  let found = 0
  let newEvents = 0
  let skipped = 0

  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    const rawBlock = rawBlocks[i] ?? {
      blockHash: hashContent(event.rawText),
      identityKey: hashContent(event.rawText),
      rawText: event.rawText,
    }

    found++

    if (existingBlockHashes.has(rawBlock.blockHash)) {
      skipped++
      continue
    }

    const existingDup = await prisma.event.findFirst({
      where: {
        eventName: { equals: event.eventName, mode: "insensitive" },
        locationId: cityLocation.id,
        eventDateStart: event.eventDateStart ?? undefined,
      },
    })
    if (existingDup) {
      skipped++
      continue
    }

    const seenBlock = await prisma.seenBlock.upsert({
      where: { sourceId_blockHash: { sourceId: source.id, blockHash: rawBlock.blockHash } },
      create: {
        sourceId: source.id,
        blockHash: rawBlock.blockHash,
        identityKey: rawBlock.identityKey,
      },
      update: { lastSeenAt: new Date() },
    })

    await prisma.event.create({
      data: {
        locationId: cityLocation.id,
        venueId: source.venueId,
        matchType: "venue_matched_from_source",
        eventName: event.eventName,
        eventDateStart: event.eventDateStart,
        eventDateEnd: event.eventDateEnd,
        sourceUrl: event.sourceUrl,
        sourceUrlIsListingFallback: !event.sourceUrl,
        seenBlockId: seenBlock.id,
        extractionMethod: "gemini_location_search",
        runId,
        status: "new",
        rawVenueText: source.venue.name,
        rawLocationText: `${source.venue.city}, ${source.venue.state ?? ""}`.trim(),
      },
    })

    newEvents++
    console.log(`[scrapeGeminiVenues]   + "${event.eventName}" (${event.eventDateStart?.toISOString().slice(0, 10) ?? "no date"}) at ${source.venue.name}`)
  }

  return { newEvents, skipped, found }
}

async function updateSourceCheck(sourceId: string, found: boolean) {
  await prisma.venueDirectorySource.update({
    where: { id: sourceId },
    data: {
      lastScrapedAt: new Date(),
      nextCheckAt: new Date(
        Date.now() + LOCATION_SEARCH_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
      ),
      healthStatus: found ? "valid" : "valid",
    },
  })
}

main()
  .catch((e) => { console.error("[scrapeGeminiVenues] Fatal:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
