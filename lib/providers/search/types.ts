export interface SearchProvider {
  name: string
  search(query: string, opts?: { maxResults?: number }): Promise<SearchResult[]>
}

export interface SearchResult {
  title: string
  url: string
  content: string
  score?: number
}

export interface SearchProviderConfig {
  provider: SearchProvider
  priority: number
  dailyLimit: number
  enabled: boolean
}
