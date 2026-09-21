import type { SearchProvider, SearchResult } from "./types"
import { search as googleSearch, OrganicResult } from "google-sr"

export function createGoogleProvider(): SearchProvider {
  return {
    name: "google",
    async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
      const max = opts?.maxResults ?? 5

      const results = await googleSearch({
        query,
        parsers: [OrganicResult],
      })

      return results
        .slice(0, max)
        .filter((r) => r.title && r.link)
        .map((r) => ({
          title: r.title ?? "",
          url: r.link ?? "",
          content: r.description ?? "",
          score: 0.4,
        }))
    },
  }
}

export async function searchGooglePaginated(
  query: string,
  maxResults: number,
  maxPages: number
): Promise<SearchResult[]> {
  const all: SearchResult[] = []

  for (let page = 1; page <= maxPages && all.length < maxResults; page++) {
    const results = await googleSearch({
      query,
      parsers: [OrganicResult],
      noPartialResults: true,
    })

    if (results.length === 0) break

    for (const r of results) {
      all.push({
        title: r.title,
        url: r.link,
        content: r.description ?? "",
        score: 0.4,
      })
      if (all.length >= maxResults) break
    }

    if (results.length < 10) break
  }

  return all.slice(0, maxResults)
}
