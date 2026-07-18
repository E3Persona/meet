import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { runSearchScraper, SearchQuery } from "@/lib/ingest/search-pipeline"
import { buildSearchQueries } from "@/lib/ingest/build-queries"
import { runManualSourceChecks } from "@/lib/ingest/manual-scraper"
import { Prisma } from "@/lib/generated/prisma/client"
import { getAllProviderStatus, DEV_MODE } from "@/lib/providers/credit-tracker"
import { createProgressCallback, clearRunProgress } from "@/lib/ingest/progress-store"
import { scrapeConventionPlanit } from "@/lib/scrapers/conventionplanit"
import { isExcludedDomain, isExcludedHostname } from "@/lib/scrapers/dedicated-domains"

// ─── Scraper types ───────────────────────────────────────────────────────────

type ScraperType = "ica" | "cn" | "tf" | "showsbee" | "eventseye" | "aca" | "search" | "cp"

interface ScraperResult {
  scraper: ScraperType
  recordsFound: number
  recordsNew: number
  error?: string
  provider?: string
  providerWarnings?: string[]
}

interface RunConfig {
  scraperTypes: ScraperType[]
  locationIds?: string[]
  templateIds?: string[]
  maxQueries?: number
  dateFrom?: string
  dateTo?: string
  sourceSiteId?: string
  forceRefresh?: boolean
}

// ─── Frequency tracking using IngestionSchedule ─────────────────────────────

interface RunHistoryEntry {
  locationId: string
  searchTerm: string | null
  runAt: string
}

interface RunHistory {
  entries: RunHistoryEntry[]
}

const FREQUENCY_LIMIT = 2
const FREQUENCY_WINDOW_DAYS = 30

async function filterByFrequency(
  locationIds: string[],
  trigger: "scheduled" | "manual"
): Promise<{
  filteredLocationIds: string[]
  skipped: string[]
}> {
  if (trigger === "manual") {
    return { filteredLocationIds: locationIds, skipped: [] }
  }

  const now = new Date()
  const cutoffDate = new Date(now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  let schedule = await prisma.ingestionSchedule.findFirst({
    where: { name: "default-frequency-tracker" },
  })

  if (!schedule) {
    schedule = await prisma.ingestionSchedule.create({
      data: {
        name: "default-frequency-tracker",
        cronExpr: "0 0 * * *",
        locationIds: [],
        templateIds: [],
        sourceSiteIds: [],
        runHistory: { entries: [] } as any,
      },
    })
  }

  const history: RunHistory = (schedule.runHistory as unknown as RunHistory) || { entries: [] }
  const recentEntries = history.entries.filter((e) => new Date(e.runAt) >= cutoffDate)

  const locationRunCount = new Map<string, number>()
  const locationLastRun = new Map<string, number>()

  for (const entry of recentEntries) {
    locationRunCount.set(entry.locationId, (locationRunCount.get(entry.locationId) || 0) + 1)
    const runTime = new Date(entry.runAt).getTime()
    const currentLast = locationLastRun.get(entry.locationId) || 0
    if (runTime > currentLast) {
      locationLastRun.set(entry.locationId, runTime)
    }
  }

  const skipped: string[] = []
  const filteredLocationIds: string[] = []

  for (const id of locationIds) {
    const count = locationRunCount.get(id) || 0
    if (count >= FREQUENCY_LIMIT) {
      skipped.push(`Location ${id} (ran ${count} times in ${FREQUENCY_WINDOW_DAYS} days)`)
      continue
    }
    filteredLocationIds.push(id)
  }

  filteredLocationIds.sort((a, b) => {
    const aLast = locationLastRun.get(a) || 0
    const bLast = locationLastRun.get(b) || 0
    if (aLast === 0 && bLast === 0) return 0
    if (aLast > 0 && bLast === 0) return 1
    if (aLast === 0 && bLast > 0) return -1
    return aLast - bLast
  })

  const newEntries: RunHistoryEntry[] = filteredLocationIds.map((id) => ({
    locationId: id,
    searchTerm: null,
    runAt: now.toISOString(),
  }))

  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const allEntries = [...recentEntries, ...newEntries].filter(
    (e) => new Date(e.runAt) >= ninetyDaysAgo
  )

  await prisma.ingestionSchedule.update({
    where: { id: schedule.id },
    data: {
      runHistory: { entries: allEntries } as any,
      lastRunAt: now,
    },
  })

  return { filteredLocationIds, skipped }
}

// ─── Domain exclusion for dedicated scrapers ───────────────────────────────
// (imported from centralized source at lib/scrapers/dedicated-domains.ts)

// ─── Shared ingest runner ────────────────────────────────────────────────────
async function runIngest(
  trigger: "scheduled" | "manual",
  body: RunConfig,
  clientRunId?: string
) {
  console.log(`\n[Ingest] Starting ${trigger} run at ${new Date().toISOString()}`)
  if (body.locationIds?.length) console.log(`[Ingest] Targeting ${body.locationIds.length} location(s)`)
  if (body.templateIds?.length) console.log(`[Ingest] Targeting ${body.templateIds.length} template(s)`)
  if (body.dateFrom || body.dateTo) console.log(`[Ingest] Date range: ${body.dateFrom ?? "any"} → ${body.dateTo ?? "any"}`)
  if (body.sourceSiteId) console.log(`[Ingest] Targeting single source site: ${body.sourceSiteId}`)

  const run = await prisma.ingestionRun.create({ data: { id: clientRunId ?? undefined, trigger, status: "running" } })
  const progress = createProgressCallback(run.id)
  progress(`Run started (${trigger})`)

  try {
    if (body.sourceSiteId) {
      const site = await prisma.sourceSite.findUnique({ where: { id: body.sourceSiteId } })
      if (!site) return NextResponse.json({ error: "Source site not found" }, { status: 404 })
      if (site.sourceMode === "manual") {
        progress(`Manual source: ${site.name} — recorded check`)
        const manualResults = await runManualSourceChecks(run.id, { sourceSiteId: body.sourceSiteId })
        await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date(), recordsFound: 0, recordsNew: 0, providersUsed: getAllProviderStatus() } })
        clearRunProgress(run.id)
        return NextResponse.json({ runId: run.id, manualResults, note: "Manual source check recorded" })
      }
      progress(`Targeting source site: ${site.name}`)
      const queries: SearchQuery[] = [{ locationId: null, locationName: site.name, monthLabel: "site-specific", query: site.url ? `site:${new URL(site.url).hostname} events` : site.name }]
      const result = await runSearchScraper(queries, run.id, { searchConcurrency: DEV_MODE ? 10 : 5, scrapeConcurrency: DEV_MODE ? 8 : 3, forceRefresh: body.forceRefresh, progress })
      await prisma.sourceSite.update({ where: { id: body.sourceSiteId }, data: { lastScrapedAt: new Date(), lastScrapeStatus: "success" } })
      await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date(), recordsFound: result.recordsFound, recordsNew: result.recordsNew, providersUsed: getAllProviderStatus() } })
      return NextResponse.json({ runId: run.id, recordsFound: result.recordsFound, recordsNew: result.recordsNew, sourceSite: site.name })
    }

    progress("Checking manual source sites...")
    const manualResults = await runManualSourceChecks(run.id)
    const checkedManual = manualResults.filter((r) => r.status === "checked")
    const skippedManual = manualResults.filter((r) => r.status === "skipped_fresh")
    if (checkedManual.length > 0) console.log(`[Ingest] Checked ${checkedManual.length} manual source(s)`)
    if (skippedManual.length > 0) console.log(`[Ingest] ${skippedManual.length} manual source(s) skipped (fresh)`)

    let locationIds = body.locationIds
    if (!locationIds?.length) {
      const allActive = await prisma.location.findMany({ where: { active: true }, select: { id: true } })
      locationIds = allActive.map((l) => l.id)
    }

    if (locationIds.length === 0) {
      clearRunProgress(run.id)
      await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date(), recordsFound: 0, recordsNew: 0, errorMessage: "No active locations" } })
      return NextResponse.json({ runId: run.id, recordsFound: 0, recordsNew: 0, manualResults })
    }

    let filteredLocationIds = locationIds
    let skipped: string[] = []
    if (!DEV_MODE && trigger === "scheduled") {
      const freq = await filterByFrequency(locationIds, trigger)
      filteredLocationIds = freq.filteredLocationIds
      skipped = freq.skipped
    }

    if (filteredLocationIds.length === 0) {
      await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date(), recordsFound: 0, recordsNew: 0, errorMessage: "All locations skipped due to frequency limits" } })
      return NextResponse.json({ runId: run.id, recordsFound: 0, recordsNew: 0, skipped, manualResults })
    }

    progress("Building search queries...")
    const queries = await buildSearchQueries({ locationIds: filteredLocationIds, templateIds: body.templateIds, dateFrom: body.dateFrom, dateTo: body.dateTo, maxQueries: DEV_MODE ? undefined : (body.maxQueries ?? undefined) })

    const results: ScraperResult[] = []
    let totalFound = 0
    let totalNew = 0

    for (const scraperType of body.scraperTypes) {
      console.log(`\n[Ingest] Running scraper: ${scraperType}`)
      if (scraperType === "search") {
        const r = await runSearchScraper(queries, run.id, {
          searchConcurrency: DEV_MODE ? 10 : (trigger === "scheduled" ? 5 : 10),
          scrapeConcurrency: DEV_MODE ? 8 : (trigger === "scheduled" ? 3 : 8),
          dryRun: false,
          forceRefresh: body.forceRefresh,
          progress,
        })
        results.push(r)
        totalFound += r.recordsFound
        totalNew += r.recordsNew
        console.log(`[Ingest] ${scraperType}: ${r.recordsNew} new from ${r.recordsFound}`)
      }
      if (scraperType === "cp") {
        progress("Scraping ConventionPlanit venue directory...")
        const activeCities = await prisma.location.findMany({ where: { active: true, type: "CITY" }, select: { city: true, state: true } })
        const cpResults = await scrapeConventionPlanit(activeCities)
        progress(`ConventionPlanit: ${cpResults.length} venue(s) matched`)
        let venuesCreated = 0
        for (const r of cpResults) {
          const cityLoc = activeCities.find((c) => (c.city ?? "").toLowerCase() === r.venue.city.toLowerCase())
          const city = cityLoc?.city ?? r.venue.city
          const state = cityLoc?.state ?? r.venue.state
          const existing = await prisma.location.findFirst({ where: { name: r.venue.name, type: "VENUE" } })
          if (existing) {
            await prisma.location.update({ where: { id: existing.id }, data: { address: r.detail.address ?? existing.address, city: r.detail.city ?? existing.city ?? city, state: r.detail.state ?? existing.state ?? state, sourceUrl: r.venue.detailUrl, lastIngestedAt: new Date() } })
          } else {
            await prisma.location.create({ data: { type: "VENUE", name: r.venue.name, address: r.detail.address, city: r.detail.city ?? city, state: r.detail.state ?? state, sourceUrl: r.venue.detailUrl, active: true } })
            venuesCreated++
          }
        }
        totalFound += cpResults.length
        totalNew += venuesCreated
        progress(`ConventionPlanit: ${venuesCreated} new venue(s) created, ${cpResults.length} total matched`)
        results.push({ scraper: "cp", recordsFound: cpResults.length, recordsNew: venuesCreated })
      }
    }

    progress(`Complete: ${totalNew} new events found, ${totalFound} scanned`)

    const processedIds = [...new Set([...(filteredLocationIds ?? []), ...queries.map((q) => q.locationId).filter(Boolean)])] as string[]
    if (processedIds.length > 0) await prisma.location.updateMany({ where: { id: { in: processedIds } }, data: { lastIngestedAt: new Date() } })

    const providersUsed = getAllProviderStatus()
    await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "success", finishedAt: new Date(), recordsFound: totalFound, recordsNew: totalNew, providersUsed } })
    console.log(`\n[Ingest] Complete: ${totalNew} new from ${totalFound} total`)

    const allWarnings = results.flatMap((r) => r.providerWarnings ?? [])
    return NextResponse.json({ runId: run.id, recordsFound: totalFound, recordsNew: totalNew, results, providersUsed, skipped, warnings: allWarnings, manualResults: { checked: checkedManual.length, skipped: skippedManual.length } })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown"
    console.error(`[Ingest] Fatal:`, error)
    await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), errorMessage } })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

// ─── GET /api/ingest/run ─── cron entry point ───────────────────────────────
export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_SHEETS_SYNC_API_KEY
  const authHeader = request.headers.get("authorization") ?? ""
  const token = authHeader.replace(/^Bearer /i, "").trim()
  if (!apiKey || token !== apiKey) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `https://${request.headers.get("host")}`
  const trigger = "scheduled"

  const parentRun = await prisma.ingestionRun.create({
    data: { trigger, status: "running" },
  })

  const scraperRoutes = [
    "/api/ingest/aca",
    "/api/ingest/asae",
    "/api/ingest/blackmeetings",
    "/api/ingest/cn",
    "/api/ingest/eventseye",
    "/api/ingest/generic-llm",
    "/api/ingest/ica",
    "/api/ingest/infosec",
    "/api/ingest/sgmp",
    "/api/ingest/showsbee",
    "/api/ingest/tf",
    "/api/ingest/thetradeshowcalendar",
  ]

  const scraperResults = await Promise.allSettled(
    scraperRoutes.map((route) =>
      fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-parent": parentRun.id,
          "x-cron-trigger": trigger,
        },
        body: JSON.stringify({}),
      }).then(async (res) => ({
        route,
        status: res.status,
        body: await res.clone().json().catch(() => null),
      }))
    )
  )

  const scraperSummary = scraperResults.map((r, i) => {
    if (r.status === "rejected") {
      return { route: scraperRoutes[i], status: "error", error: String(r.reason) }
    }
    return { route: r.value.route, status: r.value.status, runId: r.value.body?.runId ?? null }
  })

  const searchResult = await runIngest(trigger, { scraperTypes: ["search", "cp"] })

  await prisma.ingestionRun.update({
    where: { id: parentRun.id },
    data: { status: "success", finishedAt: new Date() },
  })

  return NextResponse.json({
    parentRunId: parentRun.id,
    scrapers: scraperSummary,
    searchPipeline: searchResult,
  })
}

// ─── POST /api/ingest/run ───────────────────────────────────────────────────
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const trigger = searchParams.get("trigger") === "scheduled" ? "scheduled" : "manual"

  let body: RunConfig = { scraperTypes: ["search"] }
  let clientRunId: string | undefined
  try {
    const raw = await request.json()
    if (raw.scraperTypes && Array.isArray(raw.scraperTypes)) body.scraperTypes = raw.scraperTypes
    if (raw.locationIds) body.locationIds = raw.locationIds
    if (raw.templateIds) body.templateIds = raw.templateIds
    if (raw.maxQueries) body.maxQueries = raw.maxQueries
    if (raw.dateFrom) body.dateFrom = raw.dateFrom
    if (raw.dateTo) body.dateTo = raw.dateTo
    if (raw.sourceSiteId) body.sourceSiteId = raw.sourceSiteId
    if (raw.forceRefresh) body.forceRefresh = true
    if (raw.clientRunId) clientRunId = raw.clientRunId
  } catch { /* no body */ }

  return runIngest(trigger, body, clientRunId)
}
