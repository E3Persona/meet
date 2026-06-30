// ─── Cost Tracker ────────────────────────────────────────────────────────────
// In-memory tracker for provider usage per ingestion run.
// Persisted to IngestionRun.providersUsed as JSON.

interface UsageEntry {
  provider: string
  type: "search" | "scrape"
  runId?: string
  timestamp: number
}

const usageLog: UsageEntry[] = []

export function trackUsage(provider: string, type: "search" | "scrape", runId?: string) {
  usageLog.push({
    provider,
    type,
    runId,
    timestamp: Date.now(),
  })
}

export function getUsageSummary(runId?: string): Record<string, { search: number; scrape: number }> {
  const entries = runId ? usageLog.filter((e) => e.runId === runId) : usageLog
  const summary: Record<string, { search: number; scrape: number }> = {}

  for (const entry of entries) {
    if (!summary[entry.provider]) {
      summary[entry.provider] = { search: 0, scrape: 0 }
    }
    summary[entry.provider][entry.type]++
  }

  return summary
}

export function clearUsage(runId?: string) {
  if (runId) {
    const idx = usageLog.findIndex((e) => e.runId === runId)
    if (idx >= 0) usageLog.splice(idx, usageLog.length)
  } else {
    usageLog.length = 0
  }
}
