import type { SearchProvider, SearchResult } from "./types"

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
]

function pickUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
}

function parseResults(html: string, max: number): SearchResult[] {
  const results: SearchResult[] = []

  // Pattern 1: rel="nofollow" links with result-snippet
  const resultRegex = /<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*class="result-link"[^>]*>([^<]+)<\/a>[\s\S]*?<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi
  let match
  while ((match = resultRegex.exec(html)) !== null && results.length < max) {
    const url = match[1]?.trim()
    const title = match[2]?.trim()
    const content = match[3]?.replace(/<[^>]+>/g, "").trim()
    if (url && title && !url.includes("duckduckgo.com")) {
      results.push({ title, url, content: content ?? "", score: 0.3 })
    }
  }

  // Pattern 2: simpler fallback
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

  // Pattern 3: HTML5 result blocks
  if (results.length === 0) {
    const blockRegex = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>[^<]*<[^>]*class="[^"]*result__a[^"]*"[^>]*>([^<]+)<\/a>/gi
    while ((match = blockRegex.exec(html)) !== null && results.length < max) {
      const url = match[1]?.trim()
      const title = match[2]?.trim()
      if (url && title && !url.includes("duckduckgo.com")) {
        results.push({ title, url, content: "", score: 0.2 })
      }
    }
  }

  return results
}

async function tryEndpoint(url: string,ua: string, timeoutMs = 8000): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, {
      headers: {
        "User-Agent": ua,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export function createDuckDuckGoProvider(): SearchProvider {
  return {
    name: "duckduckgo",
    async search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]> {
      const max = opts?.maxResults ?? 5
      const ua = pickUA()
      const params = new URLSearchParams({ q: query, kl: "us-en" })

      // Try lite endpoint first, then html endpoint as fallback
      const endpoints = [
        `https://lite.duckduckgo.com/lite/?${params}`,
        `https://html.duckduckgo.com/html/?${params}`,
      ]

      for (const url of endpoints) {
        const html = await tryEndpoint(url, ua)
        if (!html) continue

        const results = parseResults(html, max)
        if (results.length > 0) return results
      }

      // All endpoints failed or returned no parseable results — return empty, don't throw
      console.warn(`[DuckDuckGo] No results for "${query}" (all endpoints exhausted)`)
      return []
    },
  }
}
