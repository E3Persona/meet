/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from "cheerio"
import { extractEventsWithLLM } from "./llm-extractor"
import { createJinaProvider } from "@/lib/providers/scrape/jina"

export interface SourceSiteConfigInput {
  paginationType: string | null
  paginationParam: string | null
  paginationStart: number
  maxPages: number
  listingUrlTemplate: string | null
  selectorEventContainer: string | null
  selectorEventName: string | null
  selectorEventDateStart: string | null
  selectorEventDateEnd: string | null
  selectorEventUrl: string | null
  selectorVenue: string | null
  selectorCity: string | null
  followDetailPage: boolean
  firecrawlFallback: boolean
  aiFallback: boolean
  selectorDetailOrganizer: string | null
  selectorDetailEmail: string | null
  selectorDetailPhone: string | null
}

export interface ScrapeContext {
  city?: string
  month?: string
  year?: string
}

export interface ExtractedEvent {
  eventName: string | null
  eventDateStart: string | null
  eventDateEnd: string | null
  sourceUrl: string | null
  venue: string | null
  city: string | null
}

export interface PageResult {
  url: string
  pageNum: number
  events: ExtractedEvent[]
  detailEvents: ExtractedEvent[]
  aiEvents: ExtractedEvent[]
  fetchMethod: "jina" | "firecrawl"
  error?: string
}

export interface ScrapeResult {
  pages: PageResult[]
  totalContainers: number
  totalEvents: number
  errors: string[]
  aiFallbackUsed: boolean
  firecrawlFallbackUsed: boolean
}

function replaceTemplates(template: string, ctx: ScrapeContext): string {
  const now = new Date()
  return template
    .replace(/\{CITY\}/g, ctx.city ?? "")
    .replace(/\{MONTH\}/g, ctx.month ?? now.toLocaleString("en-US", { month: "long" }))
    .replace(/\{YEAR\}/g, ctx.year ?? String(now.getFullYear()))
}

function paginateUrl(baseUrl: string, pageNum: number, config: SourceSiteConfigInput): string {
  if (pageNum <= (config.paginationStart ?? 1)) return baseUrl
  const clean = baseUrl.replace(/\/+$/, "")
  if (config.paginationType === "query_param") {
    const param = config.paginationParam ?? "page"
    const sep = clean.includes("?") ? "&" : "?"
    return `${clean}${sep}${param}=${pageNum}`
  }
  if (config.paginationType === "path_segment") {
    try {
      const u = new URL(clean)
      const segments = u.pathname.split("/").filter(Boolean)
      if (segments.length > 0 && /^\d+$/.test(segments[segments.length - 1])) {
        segments[segments.length - 1] = String(pageNum)
      } else {
        segments.push(String(pageNum))
      }
      u.pathname = "/" + segments.join("/")
      return u.toString()
    } catch {
      const segments = clean.split("/")
      if (segments.length > 0 && /^\d+$/.test(segments[segments.length - 1])) {
        segments[segments.length - 1] = String(pageNum)
      } else {
        segments.push(String(pageNum))
      }
      return segments.join("/")
    }
  }
  return clean
}

function resolveUrl(href: string, base: string): string {
  if (!href) return href
  if (href.startsWith("http://") || href.startsWith("https://")) return href
  try {
    return new URL(href, base).toString()
  } catch {
    return href
  }
}

function extractText(el: cheerio.Cheerio<any>, selector: string | null): string | null {
  if (!selector) return null
  const found = el.find(selector)
  if (!found.length) return null
  const text = found.first().text().trim()
  return text || null
}

function extractHref(el: cheerio.Cheerio<any>, selector: string | null): string | null {
  if (!selector) return null
  const found = el.find(selector)
  if (!found.length) return null
  const href = found.first().attr("href")
  return href?.trim() || null
}

// Domains with dedicated scrapers - exclude from generic directory scraper
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

const jinaProvider = createJinaProvider()

async function fetchHtml(url: string): Promise<string> {
  // Use Jina as primary (free, handles anti-bot)
  const jinaResult = await jinaProvider.scrape(url, { timeout: 20000 })
  if (jinaResult.markdown) {
    // Convert markdown back to HTML for cheerio
    // Jina returns markdown, but we can still parse it with cheerio
    // For better compatibility, we'll use the markdown as-is
    // and let the LLM handle extraction from markdown
    return jinaResult.markdown
  }
  throw new Error(jinaResult.error || "Jina failed")
}

async function fetchWithFirecrawl(url: string): Promise<string> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set")

  const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ["rawHtml"],
      onlyMainContent: false,
    }),
    signal: AbortSignal.timeout(30000),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Firecrawl ${res.status}: ${text}`)
  }

  const data = await res.json()
  const html = data.data?.rawHtml
  if (!html) throw new Error("Firecrawl returned no rawHtml")
  return html
}

async function fetchHtmlWithFallback(url: string, useFirecrawl: boolean): Promise<{ html: string; method: "jina" | "firecrawl" }> {
  try {
    const html = await fetchHtml(url)
    return { html, method: "jina" }
  } catch (err) {
    // Fast-fail on permanent errors
    if (isPermanentError(err)) {
      console.log(`[Fast-fail] ${url} - permanent error, skipping Firecrawl fallback:`, err instanceof Error ? err.message : err)
      throw err
    }
    if (!useFirecrawl) throw err
    const html = await fetchWithFirecrawl(url)
    return { html, method: "firecrawl" }
  }
}

function extractEventsFromHtml(
  html: string,
  config: SourceSiteConfigInput,
  pageUrl: string
): ExtractedEvent[] {
  const $ = cheerio.load(html)
  const containers = config.selectorEventContainer
    ? $(config.selectorEventContainer)
    : $("body")

  const events: ExtractedEvent[] = []
  containers.each((_, el) => {
    const $el = $(el)
    const eventName = extractText($el, config.selectorEventName)
    const eventDateStart = extractText($el, config.selectorEventDateStart)
    if (!eventName && !eventDateStart) return

    events.push({
      eventName,
      eventDateStart,
      eventDateEnd: extractText($el, config.selectorEventDateEnd),
      sourceUrl: resolveUrl(extractHref($el, config.selectorEventUrl) ?? "", pageUrl),
      venue: extractText($el, config.selectorVenue),
      city: extractText($el, config.selectorCity),
    })
  })
  return events
}

async function extractAiEvents(
  html: string,
  url: string,
): Promise<ExtractedEvent[]> {
  const result = await extractEventsWithLLM(html, "", url)
  return result.events
    .filter((e) => e.confidence !== "low")
    .map((e) => ({
      eventName: e.eventName || null,
      eventDateStart: e.eventDateStart || null,
      eventDateEnd: e.eventDateEnd || null,
      sourceUrl: url,
      venue: null,
      city: null,
    }))
}

async function extractDetailEvent(
  detailUrl: string,
  config: SourceSiteConfigInput,
  baseEvent: ExtractedEvent
): Promise<ExtractedEvent> {
  try {
    const { html } = await fetchHtmlWithFallback(detailUrl, config.firecrawlFallback)
    const $ = cheerio.load(html)
    return {
      ...baseEvent,
      eventName: config.selectorEventName
        ? (extractText($("body"), config.selectorEventName) ?? baseEvent.eventName)
        : baseEvent.eventName,
      eventDateStart: config.selectorEventDateStart
        ? (extractText($("body"), config.selectorEventDateStart) ?? baseEvent.eventDateStart)
        : baseEvent.eventDateStart,
      eventDateEnd: config.selectorEventDateEnd
        ? (extractText($("body"), config.selectorEventDateEnd) ?? baseEvent.eventDateEnd)
        : baseEvent.eventDateEnd,
      sourceUrl: detailUrl,
      venue: config.selectorVenue
        ? (extractText($("body"), config.selectorVenue) ?? baseEvent.venue)
        : baseEvent.venue,
      city: config.selectorCity
        ? (extractText($("body"), config.selectorCity) ?? baseEvent.city)
        : baseEvent.city,
    }
  } catch {
    return baseEvent
  }
}

export async function scrapeDirectory(
  config: SourceSiteConfigInput,
  ctx: ScrapeContext
): Promise<ScrapeResult> {
  const pages: PageResult[] = []
  const errors: string[] = []
  let firecrawlFallbackUsed = false
  let aiFallbackUsed = false

  if (!config.listingUrlTemplate) {
    return { pages, totalContainers: 0, totalEvents: 0, errors: ["No listingUrlTemplate configured"], aiFallbackUsed, firecrawlFallbackUsed }
  }

  const baseUrl = replaceTemplates(config.listingUrlTemplate, ctx)
  if (isExcludedDomain(baseUrl)) {
    return { pages, totalContainers: 0, totalEvents: 0, errors: [`Domain excluded - has dedicated scraper: ${baseUrl}`], aiFallbackUsed, firecrawlFallbackUsed }
  }

  let totalContainers = 0
  let totalEvents = 0

  for (let i = 0; i < config.maxPages; i++) {
    const pageNum = (config.paginationStart ?? 1) + i
    const url = paginateUrl(baseUrl, pageNum, config)

    try {
      const { html, method } = await fetchHtmlWithFallback(url, config.firecrawlFallback)
      if (method === "firecrawl") firecrawlFallbackUsed = true

      const $ = cheerio.load(html)

      const containerSelector = config.selectorEventContainer
      const containers = containerSelector ? $(containerSelector) : $("body")
      totalContainers += containers.length

      const events = extractEventsFromHtml(html, config, url)

      // AI fallback: if aiFallback is on and selector extraction found < 2 events,
      // try LLM extraction against the raw HTML
      let aiEvents: ExtractedEvent[] = []
      if (config.aiFallback && events.length < 2) {
        const llmEvents = await extractAiEvents(html, url)
        if (llmEvents.length > events.length) {
          aiEvents = llmEvents
          aiFallbackUsed = true
        }
      }
      const useAi = aiEvents.length > 0

      const detailEvents: ExtractedEvent[] = []
      const sourceEvents = useAi ? aiEvents : events
      if (config.followDetailPage && config.selectorEventUrl && !useAi) {
        // Fetch detail pages in parallel with concurrency limit
        const detailConcurrency = 3
        const eventsWithUrls = sourceEvents.filter(ev => ev.sourceUrl)
        const eventsWithoutUrls = sourceEvents.filter(ev => !ev.sourceUrl)
        
        let active = 0
        let index = 0
        const detailPromises: Promise<ExtractedEvent>[] = []
        
        const processNext = (): void => {
          if (index >= eventsWithUrls.length) return
          const ev = eventsWithUrls[index++]
          const promise = (async () => {
            await new Promise((r) => setTimeout(r, 300)) // Reduced delay for parallel fetching
            return await extractDetailEvent(ev.sourceUrl!, config, ev)
          })()
          detailPromises.push(promise)
          active++
          promise.finally(() => {
            active--
            if (active < detailConcurrency && index < eventsWithUrls.length) {
              processNext()
            }
          })
        }
        
        // Start initial batch
        for (let i = 0; i < Math.min(detailConcurrency, eventsWithUrls.length); i++) {
          processNext()
        }
        
        const enrichedEvents = await Promise.all(detailPromises)
        detailEvents.push(...enrichedEvents, ...eventsWithoutUrls)
      } else {
        detailEvents.push(...sourceEvents)
      }

      totalEvents += (detailEvents.length || sourceEvents.length)
      pages.push({
        url,
        pageNum,
        events,
        detailEvents,
        aiEvents,
        fetchMethod: method,
      })

      if (sourceEvents.length === 0 && i > 0) break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Page ${pageNum}: ${msg}`)
      if (i === 0) break
    }
  }

  return { pages, totalContainers, totalEvents, errors, aiFallbackUsed, firecrawlFallbackUsed }
}
