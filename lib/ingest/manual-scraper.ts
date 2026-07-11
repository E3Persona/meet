import { prisma, withRetry as dbRetry } from "@/lib/prisma"

const MANUAL_FRESHNESS_DAYS = 14

export interface ManualCheckResult {
  sourceSiteId: string
  name: string
  url: string | null
  status: "checked" | "skipped_fresh" | "error"
  lastCheckAt: string | null
  note: string
}

export async function runManualSourceChecks(
  runId: string,
  opts?: { sourceSiteId?: string }
): Promise<ManualCheckResult[]> {
  const sources = await dbRetry(() => prisma.sourceSite.findMany({
    where: {
      sourceMode: "manual",
      active: true,
      ...(opts?.sourceSiteId ? { id: opts.sourceSiteId } : {}),
    },
    orderBy: { lastManualCheckAt: "asc" },
  }))

  const results: ManualCheckResult[] = []
  const now = new Date()

  for (const source of sources) {
    const daysSinceLastCheck = source.lastManualCheckAt
      ? (now.getTime() - source.lastManualCheckAt.getTime()) / (1000 * 60 * 60 * 24)
      : Infinity

    if (daysSinceLastCheck < MANUAL_FRESHNESS_DAYS) {
      results.push({
        sourceSiteId: source.id,
        name: source.name,
        url: source.url,
        status: "skipped_fresh",
        lastCheckAt: source.lastManualCheckAt?.toISOString() ?? null,
        note: `Last checked ${Math.round(daysSinceLastCheck)} days ago — skipping (< ${MANUAL_FRESHNESS_DAYS} day freshness)`,
      })
      continue
    }

    await dbRetry(() => prisma.sourceSite.update({
      where: { id: source.id },
      data: { lastManualCheckAt: now },
    }))

    results.push({
      sourceSiteId: source.id,
      name: source.name,
      url: source.url,
      status: "checked",
      lastCheckAt: now.toISOString(),
      note: source.url
        ? `Manual check recorded — review ${source.url} for new events`
        : "Manual check recorded — no URL available",
    })
  }

  return results
}
