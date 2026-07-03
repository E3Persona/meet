import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { clearUsage, getUsageSummary } from "@/lib/providers/cost-tracker"
import { runSearchScraper, SearchQuery } from "@/lib/ingest/search-pipeline"
import { Prisma } from "@/lib/generated/prisma/client"

// ─── Scraper types ───────────────────────────────────────────────────────────

type ScraperType = "ica" | "cn" | "tf" | "showsbee" | "eventseye" | "aca" | "search"

interface ScraperResult {
  scraper: ScraperType
  recordsFound: number
  recordsNew: number
  error?: string
  provider?: string
}

interface RunConfig {
  scraperTypes: ScraperType[]
  locationIds?: string[]
  maxQueries?: number // For resource limiting
}

// ─── Frequency tracking using IngestionSchedule ─────────────────────────────

interface RunHistoryEntry {
  locationId: string
  searchTerm: string | null
  runAt: string // ISO date
}

interface RunHistory {
  entries: RunHistoryEntry[]
}

const FREQUENCY_LIMIT = 2 // max runs per month per location/search term
const FREQUENCY_WINDOW_DAYS = 30 // 30-day window

async function filterByFrequency(
  locations: { id: string; name: string; city: string | null; searchTerms: { keyword: string }[] }[],
  templates: { template: string }[],
  trigger: "scheduled" | "manual"
): Promise<{
  filteredLocations: typeof locations
  filteredTemplates: typeof templates
  skipped: string[]
}> {
  // Manual runs bypass frequency limits
  if (trigger === "manual") {
    return { filteredLocations: locations, filteredTemplates: templates, skipped: [] }
  }

  const now = new Date()
  const cutoffDate = new Date(now.getTime() - FREQUENCY_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  
  // Get or create the default schedule for frequency tracking
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
  const recentEntries = history.entries.filter(e => new Date(e.runAt) >= cutoffDate)
  
  // Build frequency map: locationId -> count
  const locationRunCount = new Map<string, number>()
  const searchTermRunCount = new Map<string, number>()
  
  for (const entry of recentEntries) {
    locationRunCount.set(entry.locationId, (locationRunCount.get(entry.locationId) || 0) + 1)
    if (entry.searchTerm) {
      searchTermRunCount.set(entry.searchTerm, (searchTermRunCount.get(entry.searchTerm) || 0) + 1)
    }
  }
  
  // Filter locations and search terms based on frequency limits
  const skipped: string[] = []
  const filteredLocations: typeof locations = []
  
  for (const loc of locations) {
    const locCount = locationRunCount.get(loc.id) || 0
    if (locCount >= FREQUENCY_LIMIT) {
      skipped.push(`Location ${loc.name} (ran ${locCount} times in ${FREQUENCY_WINDOW_DAYS} days)`)
      continue
    }
    
    // Filter search terms for this location
    const filteredSearchTerms = loc.searchTerms.filter(term => {
      const termKey = `${loc.id}:${term.keyword}`
      const termCount = searchTermRunCount.get(termKey) || 0
      if (termCount >= FREQUENCY_LIMIT) {
        skipped.push(`Search term "${term.keyword}" for ${loc.name} (ran ${termCount} times)`)
        return false
      }
      return true
    })
    
    filteredLocations.push({
      ...loc,
      searchTerms: filteredSearchTerms,
    })
  }
  
  // Record this run in history
  const newEntries: RunHistoryEntry[] = []
  for (const loc of filteredLocations) {
    newEntries.push({ locationId: loc.id, searchTerm: null, runAt: now.toISOString() })
    for (const term of loc.searchTerms) {
      newEntries.push({ locationId: loc.id, searchTerm: term.keyword, runAt: now.toISOString() })
    }
  }
  
  // Update schedule with new history (keep only last 90 days)
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const allEntries = [...recentEntries, ...newEntries].filter(e => new Date(e.runAt) >= ninetyDaysAgo)
  
  await prisma.ingestionSchedule.update({
    where: { id: schedule.id },
    data: {
      runHistory: { entries: allEntries } as any,
      lastRunAt: now,
    },
  })
  
  return {
    filteredLocations,
    filteredTemplates: templates,
    skipped,
  }
}

// ─── Domain exclusion for dedicated scrapers ───────────────────────────────

const EXCLUDED_DOMAINS = [
  "allconferencealert.net",
  "conferencenext.com",
  "eventseye.com",
  "internationalconferencealerts.com",
  "showsbee.com",
  "tradefest.io",
]

function isExcludedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return EXCLUDED_DOMAINS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
  } catch {
    return false
  }
}


// ─── Build search queries from templates + locations ────────────────────────

function buildSearchQueries(
  templates: { template: string }[],
  locations: { id: string; name: string; city: string | null; searchTerms: { keyword: string }[] }[],
  maxQueries?: number
): SearchQuery[] {
  const queries: SearchQuery[] = []
  const now = new Date()

  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthLabel = `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`

    for (const loc of locations) {
      for (const tmpl of templates) {
        const expanded = tmpl.template
          .replace(/\{CITY\}/g, loc.city ?? "")
          .replace(/\{VENUE\}/g, loc.name)
          .replace(/\{MONTH\}/g, monthLabel.split(" ")[0])
          .replace(/\{YEAR\}/g, monthLabel.split(" ")[1] ?? String(new Date().getFullYear()))
        
        queries.push({
          locationId: loc.id,
          locationName: loc.name,
          monthLabel,
          query: expanded,
        })
      }

      for (const term of loc.searchTerms) {
        queries.push({
          locationId: loc.id,
          locationName: loc.name,
          monthLabel,
          query: `${monthLabel} ${term.keyword} ${loc.city ?? loc.name}`,
        })
      }
    }
  }

  // Apply maxQueries limit if specified
  if (maxQueries && queries.length > maxQueries) {
    console.log(`[Ingest] Limiting queries to ${maxQueries} (from ${queries.length} total)`)
    return queries.slice(0, maxQueries)
  }

  return queries
}

// ─── POST /api/ingest/run ───────────────────────────────────────────────────

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const trigger = searchParams.get("trigger") === "scheduled" ? "scheduled" : "manual"

  let body: RunConfig = { scraperTypes: ["search"] }
  try {
    const raw = await request.json()
    if (raw.scraperTypes && Array.isArray(raw.scraperTypes)) {
      body.scraperTypes = raw.scraperTypes
    }
    if (raw.locationIds) body.locationIds = raw.locationIds
    if (raw.maxQueries) body.maxQueries = raw.maxQueries
  } catch { /* no body */ }

  console.log(`\n[Ingest] Starting ${trigger} run at ${new Date().toISOString()}`)
  console.log(`[Ingest] Scrapers: ${body.scraperTypes.join(", ")}`)

  const run = await prisma.ingestionRun.create({ data: { trigger, status: "running" } })
  clearUsage(run.id)

  try {
    // Load locations and templates once
    const [locations, templates] = await Promise.all([
      prisma.location.findMany({
        where: { active: true, ...(body.locationIds?.length ? { id: { in: body.locationIds } } : {}) },
        include: { searchTerms: { where: { active: true } } },
      }),
      prisma.searchTemplate.findMany({ where: { active: true } }),
    ])

    if (locations.length === 0) {
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: { status: "success", finishedAt: new Date(), recordsFound: 0, recordsNew: 0, errorMessage: "No active locations" },
      })
      return NextResponse.json({ runId: run.id, recordsFound: 0, recordsNew: 0 })
    }

    // Apply frequency filtering for scheduled runs
    const { filteredLocations, filteredTemplates, skipped } = await filterByFrequency(locations, templates, trigger)
    
    if (skipped.length > 0) {
      console.log(`[Ingest] Skipped due to frequency limits (${FREQUENCY_LIMIT}x/${FREQUENCY_WINDOW_DAYS} days):`)
      skipped.forEach(s => console.log(`  - ${s}`))
    }
    
    if (filteredLocations.length === 0) {
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: { status: "success", finishedAt: new Date(), recordsFound: 0, recordsNew: 0, errorMessage: "All locations/search terms skipped due to frequency limits" },
      })
      return NextResponse.json({ runId: run.id, recordsFound: 0, recordsNew: 0, skipped })
    }

    // Apply batching based on trigger type
    let batchedLocations = filteredLocations
    let maxQueries = body.maxQueries
    
    if (trigger === "scheduled") {
      // Scheduled runs: limit to 5 locations and 50 queries max (after frequency filtering)
      const maxLocations = 5
      if (filteredLocations.length > maxLocations) {
        // Rotate locations based on run ID to ensure fairness over time
        const startIndex = parseInt(run.id.slice(-2), 16) % filteredLocations.length
        const rotated = [...filteredLocations.slice(startIndex), ...filteredLocations.slice(0, startIndex)]
        batchedLocations = rotated.slice(0, maxLocations)
        console.log(`[Ingest] Scheduled run: batching to ${maxLocations} locations (${filteredLocations.length} after frequency filtering)`)
      }
      maxQueries = maxQueries ?? 50
    } else {
      // Manual runs: process all requested locations, higher query limit
      maxQueries = maxQueries ?? 200
    }

    const results: ScraperResult[] = []
    let totalFound = 0
    let totalNew = 0

    // ── Run each scraper type in sequence ─────────────────────────────────
    for (const scraperType of body.scraperTypes) {
      console.log(`\n[Ingest] Running scraper: ${scraperType}`)

      if (scraperType === "search") {
        const queries = buildSearchQueries(templates, batchedLocations, maxQueries)
        const r = await runSearchScraper(queries, run.id, {
          searchConcurrency: trigger === "scheduled" ? 5 : 10,
          scrapeConcurrency: trigger === "scheduled" ? 3 : 8,
          dryRun: false,
        })
        results.push(r)
        totalFound += r.recordsFound
        totalNew += r.recordsNew
        console.log(`[Ingest] ${scraperType}: ${r.recordsNew} new from ${r.recordsFound}`)
      }
      // Future scraper types can be added here:
      // else if (scraperType === "ica") { ... }
      // else if (scraperType === "tf") { ... }
      // etc.
    }

    // ── Finalize ─────────────────────────────────────────────────────────
    const providersUsed = getUsageSummary(run.id)
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFound: totalFound,
        recordsNew: totalNew,
        providersUsed,
      },
    })

    console.log(`\n[Ingest] Complete: ${totalNew} new from ${totalFound} total`)
    return NextResponse.json({ runId: run.id, recordsFound: totalFound, recordsNew: totalNew, results, providersUsed, skipped })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown"
    console.error(`[Ingest] Fatal:`, error)
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), errorMessage },
    })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
