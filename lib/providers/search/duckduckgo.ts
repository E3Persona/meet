import type { SearchProvider, SearchResult } from "./types"
import { search, SafeSearchType } from "duck-duck-scrape"

export function createDuckDuckGoProvider(): SearchProvider {
  return {
    name: "duckduckgo",
    async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
      const max = opts?.maxResults ?? 5

      const data = await search(query, {
        safeSearch: SafeSearchType.MODERATE,
        offset: 0,
      })

      return data.results
        .slice(0, max)
        .map((r) => ({
          title: r.title,
          url: r.url,
          content: r.description.replace(/<[^>]+>/g, "").trim(),
          score: r.title.length > 0 ? 0.3 : 0,
        }))
    },
  }
}

export async function searchDuckDuckGoMultiPage(
  query: string,
  maxResults: number,
  maxPages: number
): Promise<SearchResult[]> {
  const all: SearchResult[] = []
  let offset = 0

  for (let page = 0; page < maxPages && all.length < maxResults; page++) {
    const data = await search(query, {
      safeSearch: SafeSearchType.MODERATE,
      offset,
    })

    if (data.noResults) break

    for (const r of data.results) {
      all.push({
        title: r.title,
        url: r.url,
        content: r.description.replace(/<[^>]+>/g, "").trim(),
        score: 0.3,
      })
      if (all.length >= maxResults) break
    }

    if (data.results.length === 0) break
    offset += 25
  }

  return all.slice(0, maxResults)
}
