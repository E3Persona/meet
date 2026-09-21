import { NextResponse } from "next/server"
import { prisma, withRetry } from "@/lib/prisma"
import { createDuckDuckGoProvider } from "@/lib/providers/search/duckduckgo"
import { createGoogleProvider } from "@/lib/providers/search/google"
import type { SearchResult } from "@/lib/providers/search/types"
import { buildSearchQueries } from "@/lib/ingest/build-queries"
import { DEV_MODE, getAllProviderStatus } from "@/lib/providers/credit-tracker"
import { createProgressCallback, clearRunProgress } from "@/lib/ingest/progress-store"

const MAX_PAGES = 3
const MAX_QUERIES_PER_RUN = 20
const SEARCH_CONCURRENCY = DEV_MODE ? 10 : 5
const PER_QUERY_RESULTS = 10
const DDG_MIN_DELAY_MS = 1500
let ddgLastRequestTime = 0

async function ddgDelay() {
  const now = Date.now()
  const elapsed = now - ddgLastRequestTime
  if (elapsed < DDG_MIN_DELAY_MS) {
    await new Promise((resolve) => setTimeout(resolve, DDG_MIN_DELAY_MS - elapsed))
  }
  ddgLastRequestTime = Date.now()
}

interface TaggedSearchResult extends SearchResult {
  source: "google" | "duckduckgo"
}

function extractPublishedDate(text: string | null): Date | null {
  if (!text) return null

  const relativeRegex = /(\d+)\s+(day|week|month|year)s?\s+ago/i
  const relativeMatch = text.match(relativeRegex)
  if (relativeMatch) {
    const value = parseInt(relativeMatch[1], 10)
    const unit = relativeMatch[2].toLowerCase()
    const date = new Date()
    switch (unit) {
      case "day":
        date.setDate(date.getDate() - value)
        break
      case "week":
        date.setDate(date.getDate() - value * 7)
        break
      case "month":
        date.setMonth(date.getMonth() - value)
        break
      case "year":
        date.setFullYear(date.getFullYear() - value)
        break
    }
    return date
  }

  const absoluteRegex = /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|December)[a-z]*\s+\d{1,2},?\s+\d{4}/i
  const absoluteMatch = text.match(absoluteRegex)
  if (absoluteMatch) {
    const parsed = new Date(absoluteMatch[0])
    if (!isNaN(parsed.getTime())) return parsed
  }

  const isoRegex = /\d{4}-\d{2}-\d{2}/
  const isoMatch = text.match(isoRegex)
  if (isoMatch) {
    const parsed = new Date(isoMatch[0])
    if (!isNaN(parsed.getTime())) return parsed
  }

  return null
}

function dedupeResults(results: TaggedSearchResult[]): TaggedSearchResult[] {
  const seen = new Set<string>()
  return results.filter((r) => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

function createLimiter(concurrency: number) {
  let active = 0
  const queue: (() => void)[] = []

  const next = () => {
    if (queue.length === 0 || active >= concurrency) return
    active++
    const run = queue.shift()!
    run()
  }

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--
            next()
          })
      })
      next()
    })
  }
}

async function searchDDG(query: string, maxResults: number): Promise<TaggedSearchResult[]> {
  const ddg = createDuckDuckGoProvider()
  try {
    await ddgDelay()
    const results = await ddg.search(query, { maxResults })
    console.log(`[WebSearch DDG] Query: "${query}" → ${results.length} results`)
    return results.map((r) => ({ ...r, source: "duckduckgo" as const }))
  } catch (error) {
    console.error(`[WebSearch DDG] Failed for "${query}":`, error instanceof Error ? error.message : error)
    return []
  }
}

async function searchGoogle(query: string, maxResults: number): Promise<TaggedSearchResult[]> {
  const google = createGoogleProvider()
  try {
    const results = await google.search(query, { maxResults })
    console.log(`[WebSearch Google] Query: "${query}" → ${results.length} results`)
    return results.map((r) => ({ ...r, source: "google" as const }))
  } catch (error) {
    console.error(`[WebSearch Google] Failed for "${query}":`, error instanceof Error ? error.message : error)
    return []
  }
}

async function searchQueryParallel(query: string, maxResults: number, limit: <T>(fn: () => Promise<T>) => Promise<T>): Promise<TaggedSearchResult[]> {
  const [ddgResults, googleResults] = await Promise.allSettled([
    limit(() => searchDDG(query, maxResults)),
    limit(() => searchGoogle(query, maxResults)),
  ])

  const combined: TaggedSearchResult[] = []
  if (ddgResults.status === "fulfilled") combined.push(...ddgResults.value)
  if (googleResults.status === "fulfilled") combined.push(...googleResults.value)

  return dedupeResults(combined)
}

async function runManualSearch(query: string, maxPages: number, runId: string) {
  const pages = Math.min(maxPages, MAX_PAGES)
  const progress = createProgressCallback(runId)

  progress(`Starting web search: "${query}"`)
  console.log(`[WebSearch Manual] Starting search for: "${query}"`)

  const limit = createLimiter(SEARCH_CONCURRENCY)

  const allResults: TaggedSearchResult[] = []

  for (let page = 0; page < pages; page++) {
    const pageResults = await searchQueryParallel(query, PER_QUERY_RESULTS, limit)
    progress(`Page ${page + 1}/${pages}: ${pageResults.length} results`)

    if (pageResults.length === 0 && page === 0) {
       progress("No results found")
       console.log(`[WebSearch Manual] No results for "${query}"`)
       break
     }

     allResults.push(...pageResults)
   }

   const deduped = dedupeResults(allResults)

   console.log(`[WebSearch Manual] "${query}" → ${allResults.length} raw, ${deduped.length} deduped`)
   deduped.forEach((r, i) => console.log(`  [${i + 1}] ${r.source}: ${r.title} — ${r.url}`))
   progress(`Saving ${deduped.length} results`)

  const webSearchQuery = await withRetry(() =>
    prisma.webSearchQuery.create({
      data: { query },
    })
  )

  const webSearchResults = await withRetry(() =>
    prisma.webSearchResult.createMany({
      data: deduped.map((r, idx) => ({
        queryId: webSearchQuery.id,
        source: r.source,
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedDate: extractPublishedDate(r.content),
        page: Math.floor(idx / 10) + 1,
      })),
    })
  )

  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      status: "success",
      finishedAt: new Date(),
      recordsFound: deduped.length,
      recordsNew: deduped.length,
      providersUsed: getAllProviderStatus(),
    },
  })

  clearRunProgress(runId)

  console.log(`[WebSearch Manual] Complete: "${query}" → ${deduped.length} results saved (runId=${runId})`)

  return NextResponse.json({
    runId,
    queryId: webSearchQuery.id,
    query: webSearchQuery.query,
    createdAt: webSearchQuery.createdAt,
    results: deduped,
    totalResults: deduped.length,
    recordsCreated: webSearchResults.count,
  })
}

async function runTemplateSearch(
  runId: string,
  locationIds: string[] | undefined,
  templateIds: string[] | undefined,
  dateFrom?: string,
  dateTo?: string
) {
  const maxQueries = DEV_MODE ? undefined : MAX_QUERIES_PER_RUN

  const searchQueries = await buildSearchQueries({
    locationIds,
    templateIds,
    dateFrom,
    dateTo,
    maxQueries,
  })

  if (searchQueries.length === 0) {
    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "No queries generated from templates",
      },
    })
    clearRunProgress(runId)
    console.log(`[WebSearch Template] No queries generated (runId=${runId})`)
    return NextResponse.json({ error: "No queries generated from templates" }, { status: 400 })
  }

  const progress = createProgressCallback(runId)
  progress(`Running ${searchQueries.length} template-based search queries`)
  console.log(`[WebSearch Template] Generated ${searchQueries.length} queries (runId=${runId})`)
  searchQueries.forEach((sq, i) => console.log(`  [${i + 1}/${searchQueries.length}] "${sq.query}" (location: ${sq.locationName})`))

  const limit = createLimiter(SEARCH_CONCURRENCY)

  const allResults: TaggedSearchResult[] = []
  const querySummary: { query: string; location: string; results: number; ddg: number; google: number }[] = []

  const searchPromises = searchQueries.map((sq) =>
    limit(async () => {
      const [ddgResults, googleResults] = await Promise.allSettled([
        searchDDG(sq.query, PER_QUERY_RESULTS),
        searchGoogle(sq.query, PER_QUERY_RESULTS),
      ])

      const combined: TaggedSearchResult[] = []
      if (ddgResults.status === "fulfilled") combined.push(...ddgResults.value)
      if (googleResults.status === "fulfilled") combined.push(...googleResults.value)

      const deduped = dedupeResults(combined)

      return {
        query: sq.query,
        location: sq.locationName,
        results: deduped,
        ddg: ddgResults.status === "fulfilled" ? ddgResults.value.length : 0,
        google: googleResults.status === "fulfilled" ? googleResults.value.length : 0,
      }
    })
  )

  const results = await Promise.allSettled(searchPromises)

  let completed = 0
  for (const result of results) {
    if (result.status === "fulfilled") {
      querySummary.push({
        query: result.value.query,
        location: result.value.location,
        results: result.value.results.length,
        ddg: result.value.ddg,
        google: result.value.google,
      })
      allResults.push(...result.value.results)
      completed++
      progress(`Completed ${completed}/${searchQueries.length} queries`)
      console.log(`[WebSearch Template] Query ${completed}/${searchQueries.length}: "${result.value.query}" → DDG: ${result.value.ddg}, Google: ${result.value.google}, deduped: ${result.value.results.length}`)
    }
  }

  const deduped = dedupeResults(allResults)

  console.log(`[WebSearch Template] Total: ${allResults.length} raw, ${deduped.length} deduped results across ${querySummary.length} queries`)
  querySummary.forEach((qs) => {
    if (qs.results > 0) {
      console.log(`  "${qs.query}" (${qs.location}): ${qs.results} results`)
    }
  })
  progress(`Saving ${deduped.length} deduplicated results`)

  const webSearchQuery = await withRetry(() =>
    prisma.webSearchQuery.create({
      data: {
        query: `Template search: ${searchQueries.length} queries for ${locationIds?.length || "all"} locations`,
      },
    })
  )

  const webSearchResults = await withRetry(() =>
    prisma.webSearchResult.createMany({
      data: deduped.map((r, idx) => ({
        queryId: webSearchQuery.id,
        source: r.source,
        title: r.title,
        url: r.url,
        snippet: r.content,
        publishedDate: extractPublishedDate(r.content),
        page: Math.floor(idx / 10) + 1,
      })),
    })
  )

  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      status: "success",
      finishedAt: new Date(),
      recordsFound: deduped.length,
      recordsNew: deduped.length,
      providersUsed: getAllProviderStatus(),
    },
  })

  clearRunProgress(runId)

  console.log(`[WebSearch Template] Complete: ${deduped.length} results saved (runId=${runId})`)
  console.log(`[WebSearch Template] Results preview:`)
  deduped.slice(0, 10).forEach((r, i) => console.log(`  [${i + 1}] ${r.source}: ${r.title} — ${r.url}`))
  if (deduped.length > 10) console.log(`  ... and ${deduped.length - 10} more`)

  return NextResponse.json({
    runId,
    queryId: webSearchQuery.id,
    query: webSearchQuery.query,
    createdAt: webSearchQuery.createdAt,
    results: deduped,
    totalResults: deduped.length,
    recordsCreated: webSearchResults.count,
    queriesProcessed: searchQueries.length,
    querySummary,
  })
}

export async function POST(request: Request) {
  let runId: string | undefined

  try {
    const body = await request.json()
    const { query, maxPages = 1, locationIds, templateIds, dateFrom, dateTo } = body

    runId = (
      await withRetry(() =>
        prisma.ingestionRun.create({
          data: {
            trigger: "manual",
            status: "running",
            recordsFound: 0,
            recordsNew: 0,
          },
        })
      )
    ).id

    if (query && typeof query === "string") {
      console.log(`[WebSearch] Manual search request: "${query}"`)
      return await runManualSearch(query, maxPages, runId)
    }

    if (locationIds || templateIds) {
      console.log(`[WebSearch] Template search request: templates=${JSON.stringify(templateIds)}, locations=${JSON.stringify(locationIds)}`)
      return await runTemplateSearch(runId, locationIds, templateIds, dateFrom, dateTo)
    }

    await prisma.ingestionRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: "Either 'query' or 'locationIds'/'templateIds' required",
      },
    })

    return NextResponse.json(
      { error: "Either 'query' or 'locationIds'/'templateIds' required" },
      { status: 400 }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown"
    console.error("[WebSearch] Error:", error)

    if (runId) {
      try {
        await prisma.ingestionRun.update({
          where: { id: runId },
          data: {
            status: "failed",
            finishedAt: new Date(),
            errorMessage,
          },
        })
      } catch {}
    }

    return NextResponse.json({ error: "Failed to perform web search" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get("limit") || "20", 10)

  try {
    const queries = await withRetry(() =>
      prisma.webSearchQuery.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
        include: {
          results: {
            orderBy: { createdAt: "asc" },
          },
        },
      })
    )

    return NextResponse.json({ queries })
  } catch (error) {
    console.error("[WebSearch] Error fetching history:", error)
    return NextResponse.json(
      { error: "Failed to fetch web search history" },
      { status: 500 }
    )
  }
}
