import type { SearchProviderConfig, SearchResult } from "./search/types"
import type { ScrapeProviderConfig, ScrapeResult } from "./scrape/types"
import { trackUsage } from "./cost-tracker"

// ─── Provider Registry ───────────────────────────────────────────────────────
// Manages search + scrape providers with automatic fallback.
// When a provider hits rate limits or errors, falls through to the next one.

export interface ProviderRegistryConfig {
  search: SearchProviderConfig[]
  scrape: ScrapeProviderConfig[]
}

export class ProviderRegistry {
  private searchProviders: SearchProviderConfig[]
  private scrapeProviders: ScrapeProviderConfig[]
  private dailyCounts: Map<string, number> = new Map()
  private resetDate: string = this.todayKey()

  constructor(config: ProviderRegistryConfig) {
    this.searchProviders = config.search
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority)
    this.scrapeProviders = config.scrape
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority)
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10)
  }

  private ensureDayRollout() {
    const today = this.todayKey()
    if (today !== this.resetDate) {
      this.dailyCounts.clear()
      this.resetDate = today
    }
  }

  private getCount(providerName: string): number {
    this.ensureDayRollout()
    return this.dailyCounts.get(providerName) ?? 0
  }

  private incrementCount(providerName: string) {
    this.ensureDayRollout()
    const current = this.dailyCounts.get(providerName) ?? 0
    this.dailyCounts.set(providerName, current + 1)
  }

  private canUse(provider: SearchProviderConfig | ScrapeProviderConfig): boolean {
    if (!provider.enabled) return false
    const count = this.getCount(provider.provider.name)
    return count < provider.dailyLimit
  }

  // ── Search ──────────────────────────────────────────────────────────────

  async search(
    query: string,
    opts?: { maxResults?: number; runId?: string }
  ): Promise<{ results: SearchResult[]; provider: string }> {
    for (const config of this.searchProviders) {
      if (!this.canUse(config)) {
        console.log(`[Provider] Skipping ${config.provider.name} — daily limit reached`)
        continue
      }

      try {
        const results = await config.provider.search(query, opts)
        this.incrementCount(config.provider.name)
        trackUsage(config.provider.name, "search", opts?.runId)
        console.log(`[Provider] ${config.provider.name} returned ${results.length} results`)
        return { results, provider: config.provider.name }
      } catch (err) {
        console.error(`[Provider] ${config.provider.name} failed:`, err)
        continue
      }
    }

    console.error("[Provider] All search providers exhausted")
    return { results: [], provider: "none" }
  }

  // ── Scrape ──────────────────────────────────────────────────────────────

  async scrape(
    url: string,
    opts?: { timeout?: number; runId?: string }
  ): Promise<{ result: ScrapeResult; provider: string }> {
    for (const config of this.scrapeProviders) {
      if (!this.canUse(config)) {
        console.log(`[Provider] Skipping ${config.provider.name} — daily limit reached`)
        continue
      }

      try {
        const result = await config.provider.scrape(url, opts)
        this.incrementCount(config.provider.name)
        trackUsage(config.provider.name, "scrape", opts?.runId)

        if (result.error) {
          console.error(`[Provider] ${config.provider.name} scrape error: ${result.error}`)
          continue
        }

        console.log(`[Provider] ${config.provider.name} scraped ${url}`)
        return { result, provider: config.provider.name }
      } catch (err) {
        console.error(`[Provider] ${config.provider.name} failed:`, err)
        continue
      }
    }

    console.error(`[Provider] All scrape providers exhausted for ${url}`)
    return { result: { markdown: null, error: "All providers exhausted" }, provider: "none" }
  }

  // ── Status ──────────────────────────────────────────────────────────────

  getStatus() {
    return {
      search: this.searchProviders.map((c) => ({
        name: c.provider.name,
        priority: c.priority,
        dailyLimit: c.dailyLimit,
        usedToday: this.getCount(c.provider.name),
        remaining: c.dailyLimit - this.getCount(c.provider.name),
      })),
      scrape: this.scrapeProviders.map((c) => ({
        name: c.provider.name,
        priority: c.priority,
        dailyLimit: c.dailyLimit,
        usedToday: this.getCount(c.provider.name),
        remaining: c.dailyLimit - this.getCount(c.provider.name),
      })),
    }
  }
}
