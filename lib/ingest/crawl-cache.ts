import { prisma } from "@/lib/prisma"
import { createHash } from "crypto"

const STALE_HOURS = Number(process.env.CRAWL_STALE_HOURS ?? 24)

export interface CrawlCheckResult {
  shouldScrape: boolean
  reason: "stale" | "never_crawled" | "within_window" | "force_refresh"
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export async function checkCrawlCache(
  url: string,
  forceRefresh: boolean
): Promise<CrawlCheckResult> {
  if (forceRefresh) return { shouldScrape: true, reason: "force_refresh" }

  const existing = await prisma.crawledUrl.findUnique({ where: { url } })
  if (!existing) return { shouldScrape: true, reason: "never_crawled" }

  const hoursOld = (Date.now() - existing.scrapedAt.getTime()) / (1000 * 60 * 60)
  if (hoursOld >= STALE_HOURS) return { shouldScrape: true, reason: "stale" }

  return { shouldScrape: false, reason: "within_window" }
}

export async function updateCrawlCache(
  url: string,
  contentHash: string,
  runId: string,
  sourceSiteId?: string
): Promise<void> {
  await prisma.crawledUrl.upsert({
    where: { url },
    update: { contentHash, scrapedAt: new Date(), runId, sourceSiteId },
    create: { url, contentHash, scrapedAt: new Date(), runId, sourceSiteId },
  })
}

export async function getCachedEvents(url: string) {
  return prisma.event.findMany({
    where: { sourceUrl: url },
    select: { id: true, eventName: true, locationId: true, eventDateStart: true, eventDateEnd: true, sourceUrl: true },
  })
}

export async function isSiteStale(sourceSiteId: string): Promise<boolean> {
  const latest = await prisma.crawledUrl.findFirst({
    where: { sourceSiteId },
    orderBy: { scrapedAt: "desc" },
  })
  if (!latest) return true
  const hoursOld = (Date.now() - latest.scrapedAt.getTime()) / (1000 * 60 * 60)
  return hoursOld >= STALE_HOURS
}

export function getStaleHours(): number {
  return STALE_HOURS
}
