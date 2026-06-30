import type { SearchProvider, SearchResult } from "./types"

const TAVILY_API_URL = "https://api.tavily.com/search"

export function createTavilyProvider(): SearchProvider {
  return {
    name: "tavily",
    async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
      const apiKey = process.env.TAVILY_API_KEY
      if (!apiKey) throw new Error("TAVILY_API_KEY not set")

      const res = await fetch(TAVILY_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: "advanced",
          max_results: opts?.maxResults ?? 5,
          include_answer: false,
        }),
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`Tavily ${res.status}: ${text}`)
      }

      const data = await res.json()
      return (data.results ?? []).map((r: { title: string; url: string; content: string; score: number }) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      }))
    },
  }
}
