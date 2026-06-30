import type { ScrapeProvider, ScrapeResult } from "./types"

// Self-hosted ai-first-scraper or Essence
// Set LOCAL_SCRAPER_URL in .env, e.g. http://localhost:8080
export function createLocalScraperProvider(): ScrapeProvider {
  return {
    name: "local",
    async scrape(url: string, opts?: { timeout?: number }): Promise<ScrapeResult> {
      const baseUrl = process.env.LOCAL_SCRAPER_URL
      if (!baseUrl) throw new Error("LOCAL_SCRAPER_URL not set")

      try {
        const scrapeUrl = new URL("/scrape", baseUrl)
        scrapeUrl.searchParams.set("url", url)

        const res = await fetch(scrapeUrl.toString(), {
          signal: AbortSignal.timeout(opts?.timeout ?? 20000),
        })

        if (!res.ok) {
          const text = await res.text()
          return { markdown: null, error: `Local ${res.status}: ${text}` }
        }

        const data = await res.json()
        return {
          markdown: data.markdown ?? data.data?.markdown ?? null,
          title: data.title ?? data.data?.title,
        }
      } catch (err) {
        return { markdown: null, error: String(err) }
      }
    },
  }
}
