// Generic LLM-powered scraper for source sites without dedicated scrapers.
// Uses the external SCRAPE_API_BASE_URL (default http://localhost:8008)
// to discover and extract events from directory/listing pages.

import { isExcludedHostname } from "./dedicated-domains"

const DEFAULT_BASE_URL = "http://localhost:8008"

export interface LlmScrapedEvent {
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  sourceUrl: string | null
  venue: string | null
  city: string | null
  confidence: string
}

export interface LlmScrapeResult {
  events: LlmScrapedEvent[]
  title: string
  url: string
  provider: string
  error?: string
}

export interface ScrapeOptions {
  url: string
  provider?: string // "openrouter" | "groq" | etc.
  prompt?: string
}

// Rate limiter: max 15 requests per minute to avoid overwhelming the API server
const RATE_LIMIT = {
  requestsPerMinute: 15,
}

class ApiRateLimiter {
  private timestamps: number[] = []

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < 60_000)
    if (this.timestamps.length >= RATE_LIMIT.requestsPerMinute) {
      const waitMs = this.timestamps[0] + 60_000 - now
      console.log(`[GenericLLM] Rate limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }
    this.timestamps.push(Date.now())
  }
}

const rateLimiter = new ApiRateLimiter()

const LIST_PROMPT = `Extract a list of events from this webpage.

For each event, return:
- eventName (string): The event/conference/meeting name
- eventDateStart (string or null): Start date in ISO format (YYYY-MM-DD) if found, else null
- eventDateEnd (string or null): End date in ISO format if it's a multi-day event, else null
- sourceUrl (string or null): The URL for a detail/register page if available
- venue (string or null): Venue name if found
- city (string or null): City where the event takes place
- confidence ("high"|"medium"|"low"): How certain you are this is a valid, upcoming event

Only extract events that are clearly displayed as upcoming/listed/future events.
Return ONLY valid JSON: {"events": [...]}`

export async function scrapeUrl(
  url: string,
  options?: Partial<ScrapeOptions>
): Promise<LlmScrapeResult> {
  const baseUrl = process.env.SCRAPE_API_BASE_URL || DEFAULT_BASE_URL
  const prompt = options?.prompt || LIST_PROMPT
  const provider = options?.provider || "openrouter"

  // Skip sites that have dedicated scrapers
  try {
    if (isExcludedHostname(new URL(url).hostname)) {
      return { events: [], title: "", url, provider, error: "Dedicated scraper exists for this domain" }
    }
  } catch {}

  await rateLimiter.waitIfNeeded()

  console.log(`[GenericLLM] Scraping ${url} via ${baseUrl}/scrape (provider: ${provider})`)

  const response = await fetch(`${baseUrl}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      provider,
      prompt,
    }),
    signal: AbortSignal.timeout(120000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error")
    throw new Error(`API ${response.status}: ${text}`)
  }

  const data = await response.json()
  return {
    events: data.events ?? data.data?.events ?? [],
    title: data.title ?? data.data?.title ?? "",
    url,
    provider,
  }
}

export async function scrapeMulti(
  urls: string[],
  options?: Partial<ScrapeOptions>
): Promise<LlmScrapeResult[]> {
  const baseUrl = process.env.SCRAPE_API_BASE_URL || DEFAULT_BASE_URL
  const prompt = options?.prompt || LIST_PROMPT
  const provider = options?.provider || "openrouter"

  await rateLimiter.waitIfNeeded()

  console.log(`[GenericLLM] Scraping ${urls.length} URLs via ${baseUrl}/scrape-multi`)

  const response = await fetch(`${baseUrl}/scrape-multi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls, provider, prompt }),
    signal: AbortSignal.timeout(180000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error")
    throw new Error(`API ${response.status}: ${text}`)
  }

  const data = await response.json()
  return data.results ?? data.data?.results ?? []
}

export async function searchEvents(
  prompt: string,
  options?: { provider?: string; maxResults?: number }
): Promise<LlmScrapedEvent[]> {
  const baseUrl = process.env.SCRAPE_API_BASE_URL || DEFAULT_BASE_URL
  const provider = options?.provider || "openrouter"
  const maxResults = options?.maxResults ?? 5

  await rateLimiter.waitIfNeeded()

  console.log(`[GenericLLM] Searching events via ${baseUrl}/search`)

  const response = await fetch(`${baseUrl}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      provider,
      max_results: maxResults,
    }),
    signal: AbortSignal.timeout(120000),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "unknown error")
    throw new Error(`API ${response.status}: ${text}`)
  }

  const data = await response.json()
  return data.results ?? data.data?.results ?? []
}
