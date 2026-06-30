import type { SearchProvider, SearchResult } from "./types"

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search"

export function createBraveProvider(): SearchProvider {
  return {
    name: "brave",
    async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
      const apiKey = process.env.BRAVE_SEARCH_API_KEY
      if (!apiKey) throw new Error("BRAVE_SEARCH_API_KEY not set")

      const params = new URLSearchParams({
        q: query,
        count: String(opts?.maxResults ?? 5),
      })

      const res = await fetch(`${BRAVE_API_URL}?${params}`, {
        headers: {
          Accept: "application/json",
          "X-Subscription-Token": apiKey,
        },
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Brave ${res.status}: ${text}`)
      }

      const data = await res.json()
      return (data.web?.results ?? []).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        content: r.description,
        score: 0.5,
      }))
    },
  }
}
