import { ProviderRegistry } from "@/lib/providers"
import { prisma } from "@/lib/prisma"
import { extractEventsWithLLM } from "@/lib/scrape/llm-extractor"
import { createTavilyProvider } from "@/lib/providers/search/tavily"
import { createBraveProvider } from "@/lib/providers/search/brave"
import { createDuckDuckGoProvider } from "@/lib/providers/search/duckduckgo"
import { createFirecrawlProvider } from "@/lib/providers/scrape/firecrawl"
import { createWebPeelProvider } from "@/lib/providers/scrape/webpeel"
import { createJinaProvider } from "@/lib/providers/scrape/jina"

// ─── Scraper types ─────────────────────────────────────────────────────────

type ScraperType = "ica" | "cn" | "tf" | "showsbee" | "eventseye" | "aca" | "search"

interface ScraperResult {
  scraper: ScraperType
  recordsFound: number
  recordsNew: number
  error?: string
  provider?: string
}

// ─── Provider registry builder ──────────────────────────────────────────────

function buildRegistry(): ProviderRegistry {
  const searchProviders = [
    { provider: createTavilyProvider(), priority: 1, dailyLimit: 33, enabled: !!process.env.TAVILY_API_KEY },
    { provider: createBraveProvider(), priority: 2, dailyLimit: 66, enabled: !!process.env.BRAVE_SEARCH_API_KEY },
    { provider: createDuckDuckGoProvider(), priority: 3, dailyLimit: 999, enabled: true },
  ]
  const scrapeProviders = [
    { provider: createJinaProvider(), priority: 1, dailyLimit: 200, enabled: true },
    { provider: createWebPeelProvider(), priority: 2, dailyLimit: 125, enabled: !!process.env.WEBPEEL_API_KEY },
    { provider: createFirecrawlProvider(), priority: 3, dailyLimit: 16, enabled: !!process.env.FIRECRAWL_API_KEY },
  ]

  console.log("[Registry] search providers:", searchProviders.map(p => `${p.provider.name}=${p.enabled ? "on" : "OFF (missing key)"}`).join(", "))
  console.log("[Registry] scrape providers:", scrapeProviders.map(p => `${p.provider.name}=${p.enabled ? "on" : "OFF (missing key)"}`).join(", "))

  return new ProviderRegistry({ search: searchProviders, scrape: scrapeProviders })
}

// ─── Location matching for general search hits ────────────────────────────────

let locationCache: { id: string; name: string; city: string | null; state: string | null }[] | null = null

async function getAllLocations(): Promise<{ id: string; name: string; city: string | null; state: string | null }[]> {
  if (locationCache) return locationCache
  locationCache = await prisma.location.findMany({
    where: { active: true },
    select: { id: true, name: true, city: true, state: true },
  })
  return locationCache
}

function matchLocation(
  eventName: string,
  locations: { id: string; name: string; city: string | null; state: string | null }[]
): { id: string; name: string } | null {
  const searchTerms = [eventName].filter(Boolean).map(s => s!.toLowerCase())
  
  for (const loc of locations) {
    const locTerms = [loc.name, loc.city, loc.state].filter(Boolean).map(s => s!.toLowerCase())
    
    // Check if any search term matches any location term
    for (const searchTerm of searchTerms) {
      for (const locTerm of locTerms) {
        // Exact match or contains match
        if (searchTerm === locTerm || searchTerm.includes(locTerm) || locTerm.includes(searchTerm)) {
          return { id: loc.id, name: loc.name }
        }
      }
    }
  }
  return null
}

// ─── Dedupe check ──────────────────────────────────────────────────────────

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

// ─── Concurrency limiter ──────────────────────────────────────────────────

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

// ─── Retry wrapper (search/scrape providers fail transiently) ─────────────

// Permanent errors that should not be retried
const PERMANENT_ERROR_PATTERNS = [
  /404|not found/i,
  /403|forbidden/i,
  /410|gone/i,
  /no such host/i,
  /ENOTFOUND/i,
  /connection refused/i,
]

function isPermanentError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return PERMANENT_ERROR_PATTERNS.some(pattern => pattern.test(msg))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  { retries = 2, baseDelayMs = 400, label = "op" }: { retries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      // Fast-fail on permanent errors
      if (isPermanentError(err)) {
        console.log(`[Fast-fail] ${label} - permanent error, skipping retries:`, err instanceof Error ? err.message : err)
        throw err
      }
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt
        console.warn(`[Retry] ${label} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms:`, err instanceof Error ? err.message : err)
        await new Promise((r) => setTimeout(r, delay))
      }
    }
  }
  throw lastErr
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

// ─── Search phase ──────────────────────────────────────────────────────────

export interface SearchHit {
  url: string
  title: string
  locationId: string | null
  locationName: string
  monthLabel: string
}

export interface SearchQuery {
  locationId: string | null
  locationName: string
  query: string
  monthLabel: string
}

async function runSearches(
  queries: SearchQuery[],
  registry: ProviderRegistry,
  runId: string,
  concurrency = 5
): Promise<{ hits: SearchHit[]; lastProvider: string; failedQueries: string[] }> {
  const limit = createLimiter(concurrency)
  const seenUrls = new Set<string>()
  const hits: SearchHit[] = []
  const failedQueries: string[] = []
  let lastProvider = "none"
  let done = 0

  await Promise.all(
    queries.map((q) =>
      limit(async () => {
        try {
          const { results, provider } = await withRetry(
            () => registry.search(q.query, { runId }),
            { label: `search "${q.query}"` }
          )
          lastProvider = provider
          done++

          if (results.length === 0) {
            console.log(`[Search] ${done}/${queries.length}: "${q.query}" → 0 results`)
            return
          }
          console.log(`[Search] ${done}/${queries.length}: "${q.query}" → ${results.length} results (${provider})`)

          for (const sr of results) {
            if (seenUrls.has(sr.url)) continue
            // Skip results from dedicated scraper domains
            if (isExcludedDomain(sr.url)) {
              console.log(`[Search] Skipping excluded domain: ${sr.url}`)
              continue
            }
            seenUrls.add(sr.url)
            hits.push({
              url: sr.url,
              title: sr.title,
              locationId: q.locationId,
              locationName: q.locationName,
              monthLabel: q.monthLabel,
            })
          }
        } catch (err) {
          done++
          failedQueries.push(q.query)
          console.error(`[Search] gave up on "${q.query}":`, err instanceof Error ? err.message : err)
        }
      })
    )
  )

  return { hits, lastProvider, failedQueries }
}

// ─── Scrape a single URL and extract events ───────────────────────────────

async function scrapeUrl(
  url: string,
  registry: ProviderRegistry,
  runId: string,
): Promise<{ markdown: string } | null> {
  try {
    const scraped = await withRetry(
      () => registry.scrape(url, { runId }),
      { label: `scrape ${url}` }
    )
    if (!scraped.result.markdown || scraped.result.markdown.length < 200) {
      console.log(`[Scrape] ${url} → no usable content (${scraped.result.markdown?.length ?? 0} chars)`)
      return null
    }
    return { markdown: scraped.result.markdown }
  } catch (err) {
    console.error(`[Scrape] failed for ${url}:`, err instanceof Error ? err.message : err)
    return null
  }
}

async function scrapeAndExtractSafe(
  hit: SearchHit,
  registry: ProviderRegistry,
  runId: string,
  counters: { totalFound: number; totalNew: number },
  opts: { dryRun?: boolean } = {}
) {
  counters.totalFound++

  const scraped = await scrapeUrl(hit.url, registry, runId)
  if (!scraped) return

  let extracted: Awaited<ReturnType<typeof extractEventsWithLLM>>["events"]
  try {
    const out = await extractEventsWithLLM(
      scraped.markdown, hit.title, hit.url, hit.locationName, hit.monthLabel, null
    )
    extracted = out.events
  } catch (err) {
    console.error(`[Extract] LLM extraction failed for ${hit.url}:`, err instanceof Error ? err.message : err)
    return
  }

  if (extracted.length === 0) {
    console.log(`[Extract] ${hit.url} → LLM returned 0 events (${scraped.markdown.length} chars scraped)`)
    return
  }

  const nonLow = extracted.filter(e => e.confidence !== "low")
  console.log(`[Extract] ${hit.url} → ${extracted.length} events found (${nonLow.length} non-low confidence, ${extracted.filter(e => e.confidence === "low").length} low)`)

  for (const ext of nonLow) {
    const eventName = ext.eventName.trim()
    if (eventName.length < 3) {
      console.log(`[Extract] Skipping "${ext.eventName}" — name too short`)
      continue
    }

    let locationId = hit.locationId
    let locationName = hit.locationName
    
    // For general search hits, try to match location from event data
    if (!locationId) {
      const locations = await getAllLocations()
      const matched = matchLocation(eventName, locations)
      if (matched) {
        locationId = matched.id
        locationName = matched.name
        console.log(`[Location Match] "${eventName}" matched to location: ${matched.name}`)
      } else {
        console.warn(`[Scrape] "${eventName}" has no locationId and no match found, skipping save (general-search hit)`)
        continue
      }
    }

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

    // ── Follow detail page if different from listing ──
    let detailMarkdown: string | null = null
    if (ext.sourceUrl && ext.sourceUrl !== hit.url) {
      console.log(`[Detail] Following detail URL for "${eventName}": ${ext.sourceUrl}`)
      const detailScraped = await scrapeUrl(ext.sourceUrl, registry, runId)
      if (detailScraped) {
        detailMarkdown = detailScraped.markdown
        counters.totalFound++
      }
    }

    // ── Re-extract from detail page for richer data ──
    let finalDates = { eventDateStart, eventDateEnd }
    let finalContacts = ext.contacts ?? []
    if (detailMarkdown) {
      try {
        const detailOut = await extractEventsWithLLM(
          detailMarkdown, eventName, ext.sourceUrl!, hit.locationName, hit.monthLabel, null
        )
        const detailEvent = detailOut.events.find(e => e.confidence !== "low")
        if (detailEvent) {
          if (detailEvent.eventDateStart) {
            const d = new Date(detailEvent.eventDateStart)
            if (!isNaN(d.getTime())) finalDates.eventDateStart = d
          }
          if (detailEvent.eventDateEnd) {
            const d = new Date(detailEvent.eventDateEnd)
            if (!isNaN(d.getTime())) finalDates.eventDateEnd = d
          }
          if (detailEvent.contacts && detailEvent.contacts.length > 0) {
            finalContacts = detailEvent.contacts
          }
        }
      } catch (err) {
        console.error(`[Detail] LLM re-extraction failed for ${ext.sourceUrl}:`, err instanceof Error ? err.message : err)
      }
    }

    if (opts.dryRun) {
      console.log(`[DryRun] Would save event: "${eventName}" dates=${finalDates.eventDateStart?.toISOString()?.slice(0,10) ?? "?"}→${finalDates.eventDateEnd?.toISOString()?.slice(0,10) ?? "?"} contacts=${finalContacts.length} @ ${hit.locationName} (${ext.sourceUrl ?? hit.url})`)
      counters.totalNew++
      continue
    }

    if (await isDuplicate(eventName, locationId, finalDates.eventDateStart)) {
      console.log(`[Scrape] Duplicate: "${eventName}" already exists`)
      continue
    }

    try {
      const event = await prisma.event.create({
        data: {
          locationId,
          eventName,
          eventDateStart: finalDates.eventDateStart,
          eventDateEnd: finalDates.eventDateEnd,
          sourceUrl: ext.sourceUrl ?? hit.url,
          runId,
        },
      })
      counters.totalNew++
      console.log(`[Scrape] Saved event: "${eventName}" (${counters.totalNew} new so far)`)

      if (finalContacts.length > 0) {
        let firstSaved = false
        for (const c of finalContacts) {
          if (!c.name || c.name.length < 2) continue
          await prisma.eventContact.create({
            data: {
              eventId: event.id,
              name: c.name,
              title: c.title,
              email: c.email,
              phone: c.phone,
              isPrimary: !firstSaved,
              sourceUrl: ext.sourceUrl ?? hit.url,
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
        console.log(`[Scrape] Saved ${finalContacts.length} contact(s) for "${eventName}"`)
      }
    } catch (err) {
      console.error(`[Scrape] failed to save "${eventName}":`, err instanceof Error ? err.message : err)
    }
  }
}

async function runScrapes(
  hits: SearchHit[],
  registry: ProviderRegistry,
  runId: string,
  concurrency = 3,
  opts: { dryRun?: boolean } = {}
): Promise<{ totalFound: number; totalNew: number }> {
  const limit = createLimiter(concurrency)
  const counters = { totalFound: 0, totalNew: 0 }

  await Promise.all(
    hits.map((hit) => limit(() => scrapeAndExtractSafe(hit, registry, runId, counters, opts)))
  )

  return counters
}

// ─── Source-site fallback (when search yields nothing for a location) ─────

async function buildFallbackQueries(
  locationsWithNoHits: { id: string; name: string; city: string | null }[],
): Promise<SearchQuery[]> {
  const sites = await prisma.sourceSite.findMany({
    where: { scrapeMode: { in: ["calendar", "directory"] }, url: { not: null }, active: true },
  })

  const fallbackQueries: SearchQuery[] = []
  for (const loc of locationsWithNoHits) {
    for (const site of sites) {
      if (!site.url) continue
      const domain = new URL(site.url).hostname
      fallbackQueries.push({
        locationId: loc.id,
        locationName: loc.name,
        monthLabel: "fallback",
        query: `site:${domain} ${loc.city ?? loc.name} events`,
      })
    }
  }
  return fallbackQueries
}

// ─── Orchestrator (replaces old runSearchScraper) ──────────────────────────

export async function runSearchScraper(
  queries: SearchQuery[],
  runId: string,
  opts: { searchConcurrency?: number; scrapeConcurrency?: number; dryRun?: boolean } = {}
): Promise<ScraperResult> {
  const registry = buildRegistry()
  console.log(`[Search] ${queries.length} queries`)

  const { hits, lastProvider, failedQueries } = await runSearches(
    queries, registry, runId, opts.searchConcurrency ?? 10
  )

  // ── Which locations got zero hits? ──
  const hitLocationIds = new Set(hits.map(h => h.locationId).filter(Boolean) as string[])
  const locationsInBatch = new Map<string, { id: string; name: string; city: string | null }>()
  for (const q of queries) {
    if (q.locationId) {
      if (!locationsInBatch.has(q.locationId)) {
        locationsInBatch.set(q.locationId, { id: q.locationId, name: q.locationName, city: null })
      }
    }
  }
  const missedLocations = [...locationsInBatch.values()].filter(l => !hitLocationIds.has(l.id))

  let allHits = hits
  if (missedLocations.length > 0) {
    console.log(`[Fallback] ${missedLocations.length} location(s) had 0 hits, checking known source sites`)
    const fallbackQueries = await buildFallbackQueries(missedLocations)
    const { hits: fallbackHits } = await runSearches(fallbackQueries, registry, runId, opts.searchConcurrency ?? 5)
    console.log(`[Fallback] +${fallbackHits.length} hits from known sources`)
    allHits = [...hits, ...fallbackHits]
  }

  console.log(`[Search] ${allHits.length} total unique URLs to scrape, ${failedQueries.length} queries failed`)

  const { totalFound, totalNew } = await runScrapes(
    allHits, registry, runId, opts.scrapeConcurrency ?? 8, { dryRun: opts.dryRun }
  )

  return { scraper: "search", recordsFound: totalFound, recordsNew: totalNew, provider: lastProvider }
}
