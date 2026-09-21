import "dotenv/config"
import axios, { AxiosError, AxiosInstance } from "axios"

export interface SerperResult {
  title: string
  url: string
  snippet: string | null
  publishedDate: string | null
  page: number
  position: number
  eventDate: string // ISO date string — the parsed date used for window filtering
}

interface SerperOrganicResult {
  title?: string
  link?: string
  snippet?: string
  date?: string
  position?: number
}

interface SerperResponse {
  organic?: SerperOrganicResult[]
  error?: string
}

export interface SerperSearchOptions {
  query: string
  pages?: number
  country?: string
  language?: string
  resultsPerPage?: number
  maxRetries?: number
  timeoutMs?: number
  monthsAhead?: number
}

const SERPER_ENDPOINT = "https://google.serper.dev/search"
const DEFAULTS = {
  pages: 3,
  country: process.env.SERPER_GL?.trim() || "us",
  language: process.env.SERPER_HL?.trim() || "en",
  resultsPerPage: 10,
  maxRetries: 3,
  timeoutMs: 30_000,
  monthsAhead: 3,
}

function getApiKey(): string {
  const key = process.env.SERPER_API_KEY?.trim()
  if (!key)
    throw new Error("SERPER_API_KEY is missing. Add it to your .env file.")
  return key
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function getBackoff(attempt: number): number {
  return 1_000 * 2 ** attempt + 250
}

function parseDate(text: string | null | undefined): Date | null {
  if (!text) return null
  const value = text.trim()

  const isoMatch = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date
    }
  }

  const monthMatch = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  )
  if (monthMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ]
    const month = monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase())
    const day = Number(monthMatch[2])
    const year = Number(monthMatch[3])
    if (month >= 0 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month, day))
    }
  }

  return null
}

function determineResultDate(result: SerperOrganicResult): Date | null {
  return parseDate(result.date) || parseDate(result.snippet)
}

// Rejects anything before the start of the current month. Accepts anything
// from the start of the current month through `monthsAhead` months forward
// (exclusive upper bound) — generalized instead of hardcoded to two buckets.
function isWithinWindow(
  date: Date,
  monthsAhead: number,
  now = new Date()
): boolean {
  const windowStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  const windowEnd = new Date(
    Date.UTC(now.getFullYear(), now.getMonth() + monthsAhead, 1)
  )
  return (
    date.getTime() >= windowStart.getTime() &&
    date.getTime() < windowEnd.getTime()
  )
}

function normalizeUrl(url: string): string {
  try {
    return new URL(url).toString().replace(/\/$/, "")
  } catch {
    return url.trim().replace(/\/$/, "")
  }
}

function isValidUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function dedupe(results: SerperResult[]): SerperResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = normalizeUrl(result.url).toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeWindowResults(
  organic: SerperOrganicResult[],
  page: number,
  monthsAhead: number
): SerperResult[] {
  const results: SerperResult[] = []

  for (const result of organic) {
    if (!result.title || !result.link || !isValidUrl(result.link)) continue

    const date = determineResultDate(result)
    // Undated results are rejected — we can't honestly claim they're in-window.
    if (!date) continue
    if (!isWithinWindow(date, monthsAhead)) continue

    results.push({
      title: result.title.trim(),
      url: normalizeUrl(result.link),
      snippet: result.snippet?.trim() || null,
      publishedDate: result.date?.trim() || date.toISOString().slice(0, 10),
      page,
      position:
        typeof result.position === "number"
          ? result.position
          : results.length + 1,
      eventDate: date.toISOString(),
    })
  }

  return results
}

async function requestSerper(
  client: AxiosInstance,
  payload: Record<string, unknown>,
  maxRetries: number
): Promise<SerperResponse> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.post("", payload)
      const status = response.status

      if (status >= 200 && status < 300) {
        const data = response.data as SerperResponse
        if (data.error) throw new Error(`Serper API error: ${data.error}`)
        return data
      }

      const errorMessage =
        response.data?.message || response.data?.error || `HTTP ${status}`

      if (isRetryableStatus(status) && attempt < maxRetries) {
        const delay = getBackoff(attempt)
        console.warn(`[Serper] HTTP ${status}. Retrying in ${delay}ms...`)
        await sleep(delay)
        continue
      }

      throw new Error(`Serper request failed: ${errorMessage}`)
    } catch (error) {
      const axiosError = error as AxiosError
      const message = axiosError?.message || String(error)
      const isLastAttempt = attempt >= maxRetries

      if (isLastAttempt) {
        throw new Error(
          `Serper request failed after ${attempt + 1} attempt(s): ${message}`
        )
      }

      const delay = getBackoff(attempt)
      console.warn(
        `[Serper] Request failed: ${message}. Retrying in ${delay}ms...`
      )
      await sleep(delay)
    }
  }

  throw new Error("Unexpected Serper request failure.")
}

/**
 * Runs a Serper Google search across `pages`, filters results to the
 * current-month..+monthsAhead window, and returns deduped results.
 * Throws only on total failure — caller decides how to handle.
 */
export async function searchSerper(
  opts: SerperSearchOptions
): Promise<SerperResult[]> {
  const options = { ...DEFAULTS, ...opts }
  const client = axios.create({
    baseURL: SERPER_ENDPOINT,
    timeout: options.timeoutMs,
    headers: {
      "X-API-KEY": getApiKey(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    validateStatus: () => true,
  })

  const allResults: SerperResult[] = []

  for (let page = 1; page <= options.pages; page++) {
    const payload = {
      q: options.query,
      gl: options.country,
      hl: options.language,
      num: options.resultsPerPage,
      page,
      type: "search",
    }

    console.log(`[Serper] "${options.query}" page ${page}/${options.pages}`)
    const data = await requestSerper(client, payload, options.maxRetries)
    const organic = data.organic ?? []

    if (organic.length === 0) break

    const windowed = normalizeWindowResults(organic, page, options.monthsAhead)
    allResults.push(...windowed)

    if (organic.length < options.resultsPerPage) break
  }

  return dedupe(allResults)
}
