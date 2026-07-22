/**
 * Validate Gemini citation-to-block mapping with real data:
 *  - Unit tests: parsers, date extractors
 *  - Integration: scrapeViaUrlContext against real venue URLs from DB,
 *    verify each parsed event has a sourceUrl from its citation
 *
 * Usage:
 *   npx tsx scripts/test-gemini-citation-mapping.ts          # unit tests only
 *   npx tsx scripts/test-gemini-citation-mapping.ts --live    # + real Gemini API calls
 */

import { prisma } from "@/lib/prisma"
import {
  scrapeViaLocationSearch,
  parseEventBlocks,
  parseSingleEventBlock,
  mapCitationsToBlocks,
} from "../lib/geminiScraper"
import { hashContent } from "../lib/scrape/blockSplitter"
import { extractDateRange } from "../lib/scrape/dateExtractor"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label}`)
    failed++
  }
}

function assertEqual<T>(actual: T, expected: T, label: string) {
  if (actual === expected) {
    console.log(`  ✅ ${label}`)
    passed++
  } else {
    console.log(`  ❌ ${label} — expected "${expected}", got "${actual}"`)
    failed++
  }
}

async function main() {
  runUnitTests()

  const isLive = process.argv.includes("--live") || process.env.LIVE === "1"
  if (isLive) await runIntegrationTest()

  await prisma.$disconnect()

  console.log(`\n═══════════════════════════════════════`)
  console.log(`  Passed: ${passed}`)
  console.log(`  Failed: ${failed}`)
  console.log(`═══════════════════════════════════════\n`)
  process.exit(failed > 0 ? 1 : 0)
}

function runUnitTests() {
  console.log("\n═══ UNIT TESTS ═══\n")

  console.log("Test 1: parseEventBlocks")

  const fullText = [
    "Here are the events I found:\n\n",
    "---EVENT---\n",
    "Name: Tech Summit 2026\n",
    "Date: July 23-30, 2026\n",
    "Time: 9:00 AM - 5:00 PM\n",
    "Description: A major tech conference\n",
    "---END_EVENT---\n\n",
    "---EVENT---\n",
    "Name: Design Conference\n",
    "Date: September 15, 2026\n",
    "Time: All day\n",
    "Description: Design industry gathering\n",
    "---END_EVENT---\n",
    "\nAlso found a third one:\n\n",
    "---EVENT---\n",
    "Name: Trade Show\n",
    "Date: August 5-8, 2026\n",
    "Time: TBD\n",
    "Description: Industry trade show\n",
    "---END_EVENT---\n",
  ].join("")

  const blocks = parseEventBlocks(fullText)
  assertEqual(blocks.length, 3, "3 event blocks extracted")
  assert(
    blocks[0].rawText.includes("Tech Summit 2026"),
    "Block 0 has Tech Summit"
  )
  assert(
    blocks[1].rawText.includes("Design Conference"),
    "Block 1 has Design Conference"
  )
  assert(blocks[2].rawText.includes("Trade Show"), "Block 2 has Trade Show")

  console.log("\nTest 2: parseSingleEventBlock")

  const block1 = parseSingleEventBlock(
    "Name: Tech Summit 2026\nDate: July 23-30, 2026\nTime: 9:00 AM\nDescription: A major tech conference"
  )
  assertEqual(block1.eventName, "Tech Summit 2026", "Name parsed correctly")
  assert(block1.eventDateStart !== null, "Date start not null")
  assertEqual(
    block1.description,
    "A major tech conference",
    "Description parsed"
  )

  const block2 = parseSingleEventBlock(
    "Name: Single Day Event\nDate: September 15, 2026\nDescription: One day only"
  )
  assertEqual(block2.eventName, "Single Day Event", "Single day name")
  assertEqual(block2.eventDateStart!.getDate(), 15, "Single day date correct")
  assertEqual(block2.eventDateStart!.getMonth(), 8, "Single day month correct")

  const block3 = parseSingleEventBlock("No date line here")
  assertEqual(block3.eventName, null, "No name returns null")
  assertEqual(block3.eventDateStart, null, "No date returns null")

  console.log("\nTest 3: extractDateRange")

  const ds1 = extractDateRange("July 23-30, 2026")
  assertEqual(ds1!.start.getDate(), 23, "July 23 start day")
  assertEqual(ds1!.end.getDate(), 30, "July 30 end day")

  const ds2 = extractDateRange("September 15, 2026")
  assertEqual(ds2!.start.getDate(), 15, "Sep 15 day")

  const ds3 = extractDateRange("August 5-8/2026")
  assertEqual(ds3!.start.getDate(), 5, "Aug 5 day")
  assertEqual(ds3!.end.getDate(), 8, "Aug 8 day")

  const ds4 = extractDateRange("7/23/2026")
  assertEqual(ds4!.start.getMonth(), 6, "7/23 month")

  const ds5 = extractDateRange("")
  assertEqual(ds5, null, "Empty string returns null")

  const ds6 = extractDateRange(null as unknown as string)
  assertEqual(ds6, null, "null returns null")

  console.log("\nTest 4: Citation-to-block mapping (synthetic)")

  const textBlock0 = [
    "Here are events:\n\n",
    "---EVENT---\n",
    "Name: Event A\nDate: July 23, 2026\nDescription: First event\n",
    "---END_EVENT---\n\n",
    "---EVENT---\n",
    "Name: Event B\nDate: September 15, 2026\nDescription: Second event\n",
    "---END_EVENT---\n",
  ].join("")

  const textBlks = parseEventBlocks(textBlock0)

  const synAnnotations = [
    {
      type: "url_citation" as const,
      start_index: textBlks[0].start + 10,
      end_index: textBlks[0].end - 5,
      title: "Page A",
      url: "https://example.com/event-a",
    },
    {
      type: "url_citation" as const,
      start_index: textBlks[1].start + 10,
      end_index: textBlks[1].end - 5,
      title: "Page B",
      url: "https://example.com/event-b",
    },
  ]
  const synMap = mapCitationsToBlocks(textBlks, synAnnotations)
  assertEqual(synMap.size, 2, "Both events got citations")
  assertEqual(
    synMap.get(0)!.url,
    "https://example.com/event-a",
    "Block 0 correct URL"
  )
  assertEqual(
    synMap.get(1)!.url,
    "https://example.com/event-b",
    "Block 1 correct URL"
  )
}

async function runIntegrationTest() {
  console.log("\n═══ INTEGRATION (live Gemini API + DB) ═══\n")

  console.log("Fetching valid VenueDirectorySource rows from DB...")

  const sources = await prisma.venueDirectorySource.findMany({
    where: {
      isActive: true,
      healthStatus: "valid",
      strategy: "jina_markdown",
    },
    include: {
      venue: { select: { id: true, name: true, city: true, state: true } },
    },
    take: 3,
    orderBy: { lastScrapedAt: { sort: "asc", nulls: "first" } },
  })

  assert(sources.length > 0, "At least 1 VenueDirectorySource row found")

  for (const source of sources) {
    const venue = source.venue as {
      id: string
      name: string
      city: string | null
      state: string | null
    }
    console.log(`\n--- ${venue.name} (${venue.city}, ${venue.state}) ---`)
    console.log(`  Source URL: ${source.sourceUrl}`)

    const visitorCount = await prisma.seenBlock.count({
      where: { sourceId: source.id },
    })
    console.log(`  Existing seen blocks: ${visitorCount}`)

    console.log("  Calling scrapeViaLocationSearch...")
    const result = await withTimeout(
      scrapeViaLocationSearch({
        id: venue.id,
        name: venue.name,
        city: venue.city ?? "",
        state: venue.state ?? "",
        directoryId: source.directoryId ?? null,
      }),
      120_000
    )
    assert(
      result.events.length >= 0,
      "scrapeViaLocationSearch returned (may be 0 events)"
    )

    console.log(
      `  Result: ${result.events.length} events, ${result.searchQueries.length} search queries`
    )
    if (result.usage) {
      console.log(`  Usage: ${JSON.stringify(result.usage)}`)
    }

    if (result.searchQueries.length > 0) {
      console.log(`  Search queries: ${result.searchQueries.join(", ")}`)
    }

    if (result.events.length === 0) {
      console.log(
        "  Gemini returned no events — search found nothing for this venue"
      )
      console.log(`  Raw blocks: ${result.rawBlocks.length}`)
      if (result.rawBlocks.length > 0) {
        console.log(
          `  First block preview: ${result.rawBlocks[0].rawText.slice(0, 200)}`
        )
      }
      continue
    }

    console.log(`\n  Gemini returned ${result.events.length} event(s):`)

    for (let i = 0; i < result.events.length; i++) {
      const ev = result.events[i]

      assert(ev.eventName.length > 0, `Event ${i + 1}: name is non-empty`)
      assert(
        ev.sourceUrl !== null,
        `Event ${i + 1}: sourceUrl from citation (got ${ev.sourceUrl ?? "null"})`
      )
      console.log(`       sourceUrl: ${ev.sourceUrl}`)

      const blockHash = hashContent(ev.rawText)
      assert(blockHash.length > 0, `Event ${i + 1}: blockHash is non-empty`)

      console.log(
        `    ${i + 1}. "${ev.eventName}" → ${ev.eventDateStart?.toISOString().slice(0, 10) ?? "no date"}`
      )
    }

    console.log(`  Usage: ${JSON.stringify(result.usage)}`)
    console.log(
      `  Search queries: ${result.searchQueries.join(", ") ?? "none"}`
    )
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms / 1000}s`)),
      ms
    )
  })
  try {
    const result = await Promise.race([promise, timeout])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
