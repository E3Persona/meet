import type { ScrapeProvider, ScrapeResult } from "./types"

// WebPeel uses a Firecrawl-compatible API
const WEBPEEL_BASE_URL = "https://api.webpeel.dev"

export function createWebPeelProvider(): ScrapeProvider {
  return {
    name: "webpeel",
    async scrape(url: string, opts?: { timeout?: number }): Promise<ScrapeResult> {
      const apiKey = process.env.WEBPEEL_API_KEY
      if (!apiKey) throw new Error("WEBPEEL_API_KEY not set")

      try {
        const res = await fetch(`${WEBPEEL_BASE_URL}/v1/scrape`, {
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
          return { markdown: null, error: `WebPeel ${res.status}: ${text}` }
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
