import type { ScrapeProvider, ScrapeResult } from "./types"

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"

export function createFirecrawlProvider(): ScrapeProvider {
  return {
    name: "firecrawl",
    async scrape(url: string, opts?: { timeout?: number }): Promise<ScrapeResult> {
      const apiKey = process.env.FIRECRAWL_API_KEY
      if (!apiKey) throw new Error("FIRECRAWL_API_KEY not set")

      try {
        const res = await fetch(FIRECRAWL_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            url,
            formats: ["markdown"],
            onlyMainContent: true,
          }),
          signal: AbortSignal.timeout(opts?.timeout ?? 30000),
        })

        if (!res.ok) {
          const text = await res.text()
          return { markdown: null, error: `Firecrawl ${res.status}: ${text}` }
        }

        const data = await res.json()
        return {
          markdown: data.data?.markdown ?? null,
          title: data.data?.metadata?.title,
        }
      } catch (err) {
        return { markdown: null, error: String(err) }
      }
    },
  }
}
