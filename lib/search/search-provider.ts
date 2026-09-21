import type { SearchResult } from "./search-shared"
import { scrapeGoogle, GoogleBlockedError } from "./google-scraper"
import { searchSerper } from "./serper"

export interface UnifiedSearchOptions {
  query: string
  pages?: number
  monthsAhead?: number
}

export interface UnifiedSearchResult {
  results: SearchResult[]
  provider: "google_scrape" | "serper_fallback"
}

/**
 * Tries the free cheerio Google-SERP scrape first. Falls back to Serper
 * (paid API) only when the scrape is blocked/captcha'd, errors outright,
 * or comes back empty. This keeps Serper usage to the minority of cases
 * where direct scraping fails.
 */
export async function searchGoogle(
  opts: UnifiedSearchOptions
): Promise<UnifiedSearchResult> {
  try {
    const results = await scrapeGoogle({
      query: opts.query,
      pages: opts.pages,
      monthsAhead: opts.monthsAhead,
    })

    if (results.length > 0) {
      return { results, provider: "google_scrape" }
    }

    console.log(
      `[SearchProvider] Google scrape returned 0 in-window results for "${opts.query}", falling back to Serper`
    )
  } catch (err) {
    const reason = err instanceof GoogleBlockedError ? "blocked" : "error"
    console.warn(
      `[SearchProvider] Google scrape ${reason} for "${opts.query}": ${(err as Error).message}. Falling back to Serper`
    )
  }

  const fallbackResults = await searchSerper({
    query: opts.query,
    pages: opts.pages,
    monthsAhead: opts.monthsAhead,
  })

  return { results: fallbackResults, provider: "serper_fallback" }
}
