export interface ScrapeProvider {
  name: string
  scrape(url: string, opts?: { timeout?: number }): Promise<ScrapeResult>
}

export interface ScrapeResult {
  markdown: string | null
  title?: string
  error?: string
}

export interface ScrapeProviderConfig {
  provider: ScrapeProvider
  priority: number
  dailyLimit: number
  enabled: boolean
}
