import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { searchGoogle } from "../lib/search/search-provider"
import { enrichEvent } from "../lib/search/enrich-event"
import { EventMatchType, LocationType } from "@/lib/generated/prisma/enums"

/*
 * Manual end-to-end test for the search-templates pipeline. Does NOT touch
 * SearchTemplate/SearchTerm/SearchExecution — it's a direct probe of
 * search-provider -> save -> enrich, independent of the round-robin
 * expansion logic in ingest-search-templates.ts. Use this to sanity-check
 * that scraping, fallback, saving, and enrichment actually work before
 * trusting a full batch run.
 *
 * Usage:
 *   npx tsx scripts/test-search-templates.ts "Delaware tradeshow september"
 *   npx tsx scripts/test-search-templates.ts "Philadelphia expo center events" --location=<locationId>
 *   npx tsx scripts/test-search-templates.ts "some query" --location=<id> --pages=2 --force-serper
 */

interface TestArgs {
  query: string
  locationId: string | null
  pages: number
  forceSerper: boolean
}

function parseArgs(): TestArgs {
  const raw = process.argv.slice(2)
  const query = raw.find((a) => !a.startsWith("--"))?.trim()

  if (!query) {
    console.error(
      'Usage: npx tsx scripts/test-search-templates.ts "search phrase" [--location=<id>] [--pages=N] [--force-serper]'
    )
    process.exit(1)
  }

  const locationArg = raw.find((a) => a.startsWith("--location="))
  const pagesArg = raw.find((a) => a.startsWith("--pages="))
  const forceSerper = raw.includes("--force-serper")

  return {
    query,
    locationId: locationArg ? locationArg.split("=")[1] : null,
    pages: pagesArg ? Math.max(1, Number(pagesArg.split("=")[1]) || 1) : 2,
    forceSerper,
  }
}

async function resolveLocation(locationId: string) {
  const location = await withRetry(() =>
    prisma.location.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, type: true, city: true, state: true },
    })
  )
  if (!location) {
    console.error(
      `[Test] --location=${locationId} does not match any Location row.`
    )
    process.exit(1)
  }
  return location
}

function matchTypeForLocationType(
  locationType: LocationType | null
): EventMatchType {
  if (locationType === "VENUE") return "venue_matched"
  if (locationType === "CITY") return "location_matched"
  return "unmatched"
}

async function main() {
  const args = parseArgs()

  console.log("========================================")
  console.log("SEARCH TEMPLATES — PIPELINE TEST")
  console.log("========================================")
  console.log(`Query:    "${args.query}"`)
  console.log(
    `Location: ${args.locationId ?? "(none — enrichment will be skipped)"}`
  )
  console.log(`Pages:    ${args.pages}`)
  console.log(
    `Mode:     ${args.forceSerper ? "forced Serper" : "google scrape with Serper fallback"}`
  )
  console.log("")

  const location = args.locationId
    ? await resolveLocation(args.locationId)
    : null
  if (location) {
    console.log(`[Test] Resolved location: ${location.name} (${location.type})`)
  }

  // ── 1. Search ──────────────────────────────────────────────────────────
  console.log("\n[Test] Step 1/4 — running search...")
  const startedAt = Date.now()

  let results
  let provider: "google_scrape" | "serper_fallback"

  if (args.forceSerper) {
    const { searchSerper } = await import("../lib/search/serper")
    results = await searchSerper({
      query: args.query,
      pages: args.pages,
      monthsAhead: 3,
    })
    provider = "serper_fallback"
  } else {
    const outcome = await searchGoogle({
      query: args.query,
      pages: args.pages,
      monthsAhead: 3,
    })
    results = outcome.results
    provider = outcome.provider
  }

  const searchMs = Date.now() - startedAt
  console.log(
    `[Test] Search complete in ${searchMs}ms via ${provider}: ${results.length} in-window results`
  )

  if (results.length === 0) {
    console.warn(
      "[Test] No results returned — nothing to save or enrich. Check the query or widen monthsAhead."
    )
  }

  // ── 2. Save WebSearchQuery + WebSearchResult ─────────────────────────────
  console.log("\n[Test] Step 2/4 — saving query + results...")
  const webSearchQuery = await withRetry(() =>
    prisma.webSearchQuery.create({ data: { query: args.query } })
  )
  console.log(`[Test] Created WebSearchQuery id=${webSearchQuery.id}`)

  const savedResultIds: string[] = []
  for (const result of results) {
    const saved = await withRetry(() =>
      prisma.webSearchResult.create({
        data: {
          queryId: webSearchQuery.id,
          source: "google",
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          publishedDate: result.eventDate ? new Date(result.eventDate) : null,
          page: result.page,
        },
      })
    )
    savedResultIds.push(saved.id)
  }
  console.log(`[Test] Saved ${savedResultIds.length} WebSearchResult rows`)

  // ── 3. Enrich (only if a location was given) ─────────────────────────────
  console.log("\n[Test] Step 3/4 — enrichment...")
  let enrichedCount = 0
  let emailCount = 0

  if (!location) {
    console.log("[Test] Skipped — no --location provided")
  } else {
    for (const result of results) {
      const enriched = await enrichEvent({
        url: result.url,
        locationId: location.id,
        matchType: matchTypeForLocationType(location.type),
        fallbackEventDate: result.eventDate,
      })
      if (enriched) {
        enrichedCount++
        if (enriched.hadEmail) emailCount++
        console.log(
          `[Test]   ✓ Enriched: "${enriched.eventName}" (${enriched.extractionMethod})`
        )
      } else {
        console.log(`[Test]   ✗ No event extracted from ${result.url}`)
      }
    }
    console.log(
      `[Test] Enriched ${enrichedCount}/${results.length} results into Events (${emailCount} with an email)`
    )
  }

  // ── 4. Verify by reading back from the DB ─────────────────────────────
  console.log("\n[Test] Step 4/4 — verifying DB state...")
  const persistedQuery = await withRetry(() =>
    prisma.webSearchQuery.findUnique({
      where: { id: webSearchQuery.id },
      include: { results: true },
    })
  )
  const persistedEvents = location
    ? await withRetry(() =>
        prisma.event.findMany({
          where: {
            locationId: location.id,
            sourceUrl: { in: results.map((r) => r.url) },
          },
          select: {
            id: true,
            eventName: true,
            eventDateStart: true,
            extractionMethod: true,
          },
        })
      )
    : []

  console.log("\n========================================")
  console.log("SUMMARY")
  console.log("========================================")
  console.log(`Provider used:         ${provider}`)
  console.log(`Search duration:       ${searchMs}ms`)
  console.log(`Results found:         ${results.length}`)
  console.log(
    `WebSearchResult rows:  ${persistedQuery?.results.length ?? 0} (persisted check)`
  )
  console.log(`Events enriched:       ${enrichedCount}`)
  console.log(
    `Events persisted:      ${persistedEvents.length} (persisted check)`
  )

  const pass =
    results.length === 0 ||
    ((persistedQuery?.results.length ?? 0) === results.length &&
      (!location || persistedEvents.length === enrichedCount))

  console.log(
    `\nResult: ${pass ? "PASS ✓" : "FAIL ✗ — persisted counts don't match run counts, check logs above"}`
  )

  if (!pass) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error("[Test] Fatal error:", err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
