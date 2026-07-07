export type ProviderType = "search" | "scrape" | "llm"

export interface ProviderLimit {
  dailyRequests: number   // -1 = unlimited
  dailyTokens: number     // -1 = unlimited (for LLM; ignored for search/scrape)
}

const PROVIDER_LIMITS: Record<string, ProviderLimit> = {
  tavily:    { dailyRequests: Number(process.env.TAVILY_DAILY_LIMIT ?? 33),   dailyTokens: -1 },
  brave:     { dailyRequests: Number(process.env.BRAVE_DAILY_LIMIT ?? 66),   dailyTokens: -1 },
  duckduckgo:{ dailyRequests: -1, dailyTokens: -1 },
  jina:      { dailyRequests: Number(process.env.JINA_DAILY_LIMIT ?? 200),  dailyTokens: -1 },
  webpeel:   { dailyRequests: Number(process.env.WEBPEEL_DAILY_LIMIT ?? 125), dailyTokens: -1 },
  firecrawl: { dailyRequests: Number(process.env.FIRECRAWL_DAILY_LIMIT ?? 16), dailyTokens: -1 },
  groq:      { dailyRequests: Number(process.env.GROQ_DAILY_LIMIT ?? 1000), dailyTokens: Number(process.env.GROQ_DAILY_TOKEN_LIMIT ?? 100000) },
  openrouter:{ dailyRequests: Number(process.env.OPENROUTER_DAILY_LIMIT ?? 200), dailyTokens: Number(process.env.OPENROUTER_DAILY_TOKEN_LIMIT ?? 500000) },
}

const DEV_MODE = process.env.DEV_MODE === "1" || process.env.DEV_MODE === "true"

interface UsageEntry {
  provider: string
  type: ProviderType
  tokens?: number
  timestamp: number
}

const usageLog: UsageEntry[] = []
let resetDate = new Date().toISOString().slice(0, 10)

function ensureDayRoll() {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== resetDate) {
    usageLog.length = 0
    resetDate = today
  }
}

function todayEntries(): UsageEntry[] {
  ensureDayRoll()
  const todayStart = new Date().setHours(0, 0, 0, 0)
  return usageLog.filter(e => e.timestamp >= todayStart)
}

export function getProviderLimit(name: string): ProviderLimit {
  const lower = name.toLowerCase()
  return PROVIDER_LIMITS[lower] ?? { dailyRequests: -1, dailyTokens: -1 }
}

export function trackUsage(
  provider: string,
  type: ProviderType,
  tokens?: number
) {
  ensureDayRoll()
  usageLog.push({ provider, type, tokens, timestamp: Date.now() })
}

export function canUseProvider(name: string): { allowed: boolean; reason?: string } {
  if (DEV_MODE) return { allowed: true }

  const limit = getProviderLimit(name)
  if (limit.dailyRequests === -1) return { allowed: true }

  const today = todayEntries()
  const requestsToday = today.filter(e => e.provider.toLowerCase() === name.toLowerCase()).length

  if (requestsToday >= limit.dailyRequests) {
    return { allowed: false, reason: `${name}: daily request limit reached (${requestsToday}/${limit.dailyRequests})` }
  }

  if (limit.dailyTokens !== -1) {
    const tokensToday = today
      .filter(e => e.provider.toLowerCase() === name.toLowerCase())
      .reduce((sum, e) => sum + (e.tokens ?? 0), 0)
    if (tokensToday >= limit.dailyTokens) {
      return { allowed: false, reason: `${name}: daily token limit reached (${tokensToday}/${limit.dailyTokens})` }
    }
  }

  return { allowed: true }
}

export function getUsageSummary(): Record<string, { requests: number; tokens: number }> {
  const today = todayEntries()
  const summary: Record<string, { requests: number; tokens: number }> = {}

  for (const entry of today) {
    if (!summary[entry.provider]) {
      summary[entry.provider] = { requests: 0, tokens: 0 }
    }
    summary[entry.provider].requests++
    summary[entry.provider].tokens += entry.tokens ?? 0
  }

  return summary
}

export function getAllProviderStatus(): Record<string, any> {
  const today = todayEntries()
  const result: Record<string, any> = {}

  for (const [name, limit] of Object.entries(PROVIDER_LIMITS)) {
    const used = today.filter(e => e.provider.toLowerCase() === name)
    const requests = used.length
    const tokens = used.reduce((s, e) => s + (e.tokens ?? 0), 0)
    result[name] = {
      requests,
      tokens,
      dailyLimitRequests: limit.dailyRequests,
      dailyLimitTokens: limit.dailyTokens,
      remainingRequests: limit.dailyRequests === -1 ? -1 : Math.max(0, limit.dailyRequests - requests),
      remainingTokens: limit.dailyTokens === -1 ? -1 : Math.max(0, limit.dailyTokens - tokens),
    }
  }

  result._devMode = DEV_MODE
  return result
}

export { DEV_MODE }
