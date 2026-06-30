import type { ScrapeProvider, ScrapeResult } from "./types"

// Jina Reader: free markdown extraction via r.jina.ai/URL
export function createJinaProvider(): ScrapeProvider {
  return {
    name: "jina",
    async scrape(url: string, opts?: { timeout?: number }): Promise<ScrapeResult> {
      try {
        const res = await fetch(`https://r.jina.ai/${url}`, {
          headers: {
            Accept: "text/markdown",
            "X-No-Cache": "true",
          },
          signal: AbortSignal.timeout(opts?.timeout ?? 20000),
        })

        if (!res.ok) {
          const text = await res.text()
          return { markdown: null, error: `Jina ${res.status}: ${text}` }
        }

        const markdown = await res.text()
        return { markdown: markdown || null }
      } catch (err) {
        return { markdown: null, error: String(err) }
      }
    },
  }
}
