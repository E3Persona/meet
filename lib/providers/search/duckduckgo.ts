import type { SearchProvider, SearchResult } from "./types"

export function createDuckDuckGoProvider(): SearchProvider {
  return {
    name: "duckduckgo",
    async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
      const max = opts?.maxResults ?? 5

      // DuckDuckGo lite — no API key needed
      const params = new URLSearchParams({ q: query, kl: "us-en" })
      const res = await fetch(`https://lite.duckduckgo.com/lite/?${params}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; EventPipelineBot/1.0)",
        },
      })

      if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`)

      const html = await res.text()

      // Parse results from the lite HTML
      const results: SearchResult[] = []
      const resultRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class="result-link"[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi

      let match
      while ((match = resultRegex.exec(html)) !== null && results.length < max) {
        const url = match[1]?.trim()
        const title = match[2]?.trim()
        const content = match[3]?.replace(/<[^>]+>/g, "").trim()
        if (url && title) {
          results.push({ title, url, content: content ?? "", score: 0.3 })
        }
      }

      // Fallback: simpler regex if the above doesn't match
      if (results.length === 0) {
        const simpleRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result-link[^"]*"[^>]*>([^<]+)<\/a>/gi
        while ((match = simpleRegex.exec(html)) !== null && results.length < max) {
          const url = match[1]?.trim()
          const title = match[2]?.trim()
          if (url && title && !url.includes("duckduckgo.com")) {
            results.push({ title, url, content: "", score: 0.2 })
          }
        }
      }

      return results
    },
  }
}
