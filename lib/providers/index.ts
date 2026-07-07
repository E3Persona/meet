import type { SearchProviderConfig, SearchResult } from "./search/types"
import type { ScrapeProviderConfig, ScrapeResult } from "./scrape/types"
import { canUseProvider, trackUsage, getAllProviderStatus, DEV_MODE } from "./credit-tracker"

export interface ProviderRegistryConfig {
  search: SearchProviderConfig[]
  scrape: ScrapeProviderConfig[]
}

export class ProviderRegistry {
  private searchProviders: SearchProviderConfig[]
  private scrapeProviders: ScrapeProviderConfig[]
  private _warnings: string[] = []

  constructor(config: ProviderRegistryConfig) {
    this.searchProviders = config.search
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority)
    this.scrapeProviders = config.scrape
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority)
  }

  private warn(msg: string) {
    this._warnings.push(msg)
    console.warn(`[Provider Warn] ${msg}`)
  }

  getWarnings(): string[] {
    return [...this._warnings]
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async search(
    query: string,
    opts?: { maxResults?: number; runId?: string }
  ): Promise<{ results: SearchResult[]; provider: string }> {
    let lastError: string | null = null

    for (const config of this.searchProviders) {
      const check = canUseProvider(config.provider.name)
      if (!check.allowed) {
        this.warn(check.reason!)
        continue
      }

      try {
        const results = await config.provider.search(query, opts)
        trackUsage(config.provider.name, "search")
        console.log(`[Provider] ${config.provider.name} returned ${results.length} results`)
        return { results, provider: config.provider.name }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lastError = msg
        this.warn(`${config.provider.name} search failed: ${msg}`)
        console.error(`[Provider] ${config.provider.name} failed:`, err)
        continue
      }
    }

    if (lastError) {
      this.warn(`All search providers exhausted (last error: ${lastError})`)
    } else {
      this.warn("All search providers exhausted (daily limits)")
    }
    console.error("[Provider] All search providers exhausted")
    return { results: [], provider: "none" }
  }

  // ── Scrape ──────────────────────────────────────────────────────────────

  async scrape(
    url: string,
    opts?: { timeout?: number; runId?: string }
  ): Promise<{ result: ScrapeResult; provider: string }> {
    let lastError: string | null = null

    for (const config of this.scrapeProviders) {
      const check = canUseProvider(config.provider.name)
      if (!check.allowed) {
        this.warn(check.reason!)
        continue
      }

      try {
        const result = await config.provider.scrape(url, opts)
        trackUsage(config.provider.name, "scrape")

        if (result.error) {
          this.warn(`${config.provider.name} scrape error for ${url}: ${result.error}`)
          console.error(`[Provider] ${config.provider.name} scrape error: ${result.error}`)
          continue
        }

        console.log(`[Provider] ${config.provider.name} scraped ${url}`)
        return { result, provider: config.provider.name }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        lastError = msg
        this.warn(`${config.provider.name} scrape failed for ${url}: ${msg}`)
        console.error(`[Provider] ${config.provider.name} failed:`, err)
        continue
      }
    }

    if (lastError) {
      this.warn(`All scrape providers exhausted for ${url} (last error: ${lastError})`)
    } else {
      this.warn(`All scrape providers exhausted for ${url} (daily limits)`)
    }
    console.error(`[Provider] All scrape providers exhausted for ${url}`)
    return { result: { markdown: null, error: "All providers exhausted" }, provider: "none" }
  }

  // ── Status ──────────────────────────────────────────────────────────────

  getStatus() {
    const credit = getAllProviderStatus()
    return {
      search: this.searchProviders.map((c) => ({
        name: c.provider.name,
        priority: c.priority,
        ...credit[c.provider.name.toLowerCase()],
      })),
      scrape: this.scrapeProviders.map((c) => ({
        name: c.provider.name,
        priority: c.priority,
        ...credit[c.provider.name.toLowerCase()],
      })),
      warnings: this.getWarnings(),
      devMode: credit._devMode,
    }
  }
}
