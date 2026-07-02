import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ProviderRegistry } from "@/lib/providers"
import { clearUsage, getUsageSummary } from "@/lib/providers/cost-tracker"
import { createTavilyProvider } from "@/lib/providers/search/tavily"
import { createBraveProvider } from "@/lib/providers/search/brave"
import { createDuckDuckGoProvider } from "@/lib/providers/search/duckduckgo"
import { createFirecrawlProvider } from "@/lib/providers/scrape/firecrawl"
import { createWebPeelProvider } from "@/lib/providers/scrape/webpeel"
import { createJinaProvider } from "@/lib/providers/scrape/jina"
import { extractEventsWithLLM } from "@/lib/scrape/llm-extractor"

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
}

// ─── Provider registry ───────────────────────────────────────────────────────

function buildRegistry(): ProviderRegistry {
  return new ProviderRegistry({
    search: [
      { provider: createTavilyProvider(), priority: 1, dailyLimit: 33, enabled: !!process.env.TAVILY_API_KEY },
      { provider: createBraveProvider(), priority: 2, dailyLimit: 66, enabled: !!process.env.BRAVE_SEARCH_API_KEY },
      { provider: createDuckDuckGoProvider(), priority: 3, dailyLimit: 999, enabled: true },
    ],
    scrape: [
      { provider: createJinaProvider(), priority: 1, dailyLimit: 33, enabled: true },
      { provider: createWebPeelProvider(), priority: 2, dailyLimit: 125, enabled: !!process.env.WEBPEEL_API_KEY },
      { provider: createFirecrawlProvider(), priority: 3, dailyLimit: 16, enabled: !!process.env.FIRECRAWL_API_KEY },
    ],
  })
}

// ─── Dedupe check ───────────────────────────────────────────────────────────

async function isDuplicate(eventName: string, locationId: string, eventDateStart: Date | null): Promise<boolean> {
  const existing = await prisma.event.findFirst({
    where: {
      eventName: { equals: eventName, mode: "insensitive" },
      locationId,
      eventDateStart: eventDateStart ?? undefined,
    },
  })
  return !!existing
}

// ─── Template expansion ─────────────────────────────────────────────────────

function expandTemplate(template: string, location: { city: string | null; name: string }, monthLabel: string): string {
  return template
    .replace(/\{CITY\}/g, location.city ?? "")
    .replace(/\{VENUE\}/g, location.name)
    .replace(/\{MONTH\}/g, monthLabel.split(" ")[0])
    .replace(/\{YEAR\}/g, monthLabel.split(" ")[1] ?? String(new Date().getFullYear()))
}

// ─── Build search queries from templates + locations ────────────────────────

function buildQueries(
  templates: { template: string }[],
  locations: { id: string; name: string; city: string | null; searchTerms: { keyword: string }[] }[]
): { locationId: string; locationName: string; query: string; monthLabel: string }[] {
  const queries: { locationId: string; locationName: string; query: string; monthLabel: string }[] = []
  const now = new Date()

  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthLabel = `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`

    for (const loc of locations) {
      for (const tmpl of templates) {
        queries.push({
          locationId: loc.id,
          locationName: loc.name,
          query: expandTemplate(tmpl.template, loc, monthLabel),
          monthLabel,
        })
      }

      for (const term of loc.searchTerms) {
        queries.push({
          locationId: loc.id,
          locationName: loc.name,
          query: `${monthLabel} ${term.keyword} ${loc.city ?? loc.name}`,
          monthLabel,
        })
      }
    }
  }

  return queries
}

// ─── Scrape a URL and extract events ────────────────────────────────────────

async function scrapeAndExtract(
  url: string,
  title: string,
  locationId: string,
  locationName: string,
  monthLabel: string,
  registry: ProviderRegistry,
  runId: string,
  counters: { totalFound: number; totalNew: number }
) {
  counters.totalFound++

  const { result } = await registry.scrape(url, { runId })
  if (!result.markdown || result.markdown.length < 200) return

  const { events: extracted } = await extractEventsWithLLM(
    result.markdown, title, url, locationName, monthLabel, null
  )

  for (const ext of extracted) {
    if (ext.confidence === "low") continue
    const eventName = ext.eventName.trim()
    if (eventName.length < 3) continue

    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    if (ext.eventDateStart) {
      const d = new Date(ext.eventDateStart)
      if (!isNaN(d.getTime())) eventDateStart = d
    }
    if (ext.eventDateEnd) {
      const d = new Date(ext.eventDateEnd)
      if (!isNaN(d.getTime())) eventDateEnd = d
    }

    if (await isDuplicate(eventName, locationId, eventDateStart)) continue

    const event = await prisma.event.create({
      data: {
        locationId,
        eventName,
        eventDateStart,
        eventDateEnd,
        sourceUrl: url,
        runId,
      },
    })
    counters.totalNew++

    if (ext.contacts && ext.contacts.length > 0) {
      let firstSaved = false
      for (const c of ext.contacts) {
        if (!c.name || c.name.length < 2) continue
        await prisma.eventContact.create({
          data: {
            eventId: event.id,
            name: c.name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            isPrimary: !firstSaved,
            sourceUrl: url,
            confidence: c.confidence ?? "medium",
          },
        })
        if (!firstSaved) {
          await prisma.event.update({
            where: { id: event.id },
            data: {
              organizerName: c.name,
              organizerTitle: c.title,
              organizerEmail: c.email,
              organizerPhone: c.phone,
            },
          })
          firstSaved = true
        }
      }
      console.log(`[Search] Saved ${ext.contacts.length} contact(s) for "${eventName}"`)
    }
  }
}

// ─── Sleep ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── Search-based scraper ────────────────────────────────────────────────────

async function runSearchScraper(
  locations: { id: string; name: string; city: string | null; searchTerms: { keyword: string }[] }[],
  templates: { template: string }[],
  runId: string
): Promise<ScraperResult> {
  const registry = buildRegistry()
  const counters = { totalFound: 0, totalNew: 0 }

  const queries = buildQueries(templates, locations)
  console.log(`[Search] ${queries.length} queries across ${locations.length} locations`)

  let lastProvider = "none"
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i]

    const { results, provider } = await registry.search(q.query, { runId })
    lastProvider = provider

    if (results.length === 0) {
      console.log(`[Search] ${i + 1}/${queries.length}: "${q.query}" → 0 results`)
      continue
    }

    console.log(`[Search] ${i + 1}/${queries.length}: "${q.query}" → ${results.length} results (${provider})`)

    for (const sr of results) {
      await sleep(500)
      await scrapeAndExtract(sr.url, sr.title, q.locationId, q.locationName, q.monthLabel, registry, runId, counters)
    }

    if ((i + 1) % 10 === 0) {
      console.log(`[Search] Progress: ${i + 1}/${queries.length}, ${counters.totalNew} new`)
    }
  }

  return {
    scraper: "search",
    recordsFound: counters.totalFound,
    recordsNew: counters.totalNew,
    provider: lastProvider,
  }
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

    const results: ScraperResult[] = []
    let totalFound = 0
    let totalNew = 0

    // ── Run each scraper type in sequence ─────────────────────────────────
    for (const scraperType of body.scraperTypes) {
      console.log(`\n[Ingest] Running scraper: ${scraperType}`)

      if (scraperType === "search") {
        const r = await runSearchScraper(locations, templates, run.id)
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
    return NextResponse.json({ runId: run.id, recordsFound: totalFound, recordsNew: totalNew, results, providersUsed })
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
