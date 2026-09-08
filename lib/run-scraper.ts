import { prisma } from "@/lib/prisma"
import { isSiteStale, getStaleHours } from "@/lib/ingest/crawl-cache"
import { triggerIngestWorkflow } from "@/lib/github-actions"

export async function startScraperRun(
  scriptName: string,
  siteName: string,
  trigger: "manual" | "scheduled" = "manual",
  fast = false,
  dateFrom?: string,
  dateTo?: string,
  forceRefresh = false,
): Promise<{ runId: string; skipped?: boolean; workflowUrl?: string }> {
  // ── Change detection: skip if site was scraped recently ──
  if (!forceRefresh) {
    const site = await prisma.sourceSite.findFirst({ where: { name: siteName } })
    if (site) {
      const stale = await isSiteStale(site.id)
      if (!stale) {
        console.log(`[Scraper] Skipping "${siteName}" — scraped within ${getStaleHours()}h window`)
        return { runId: "", skipped: true }
      }
    }
  }

  const site = await prisma.sourceSite.findFirst({ where: { name: siteName } })
  if (site) {
    await prisma.sourceSiteConfig.upsert({
      where: { sourceSiteId: site.id },
      update: {},
      create: { sourceSiteId: site.id },
    })
  }

  const scraperKey = scriptName.replace("ingest-", "").replace(".ts", "")
  await prisma.ingestConfig.upsert({
    where: { scraper: scraperKey },
    update: {},
    create: { scraper: scraperKey },
  })

  const result = await triggerIngestWorkflow({
    scraperScript: scriptName,
    trigger,
    dateFrom,
    dateTo,
    forceRefresh,
  })
  console.log(`[Scraper] Triggered GitHub Actions for "${siteName}": ${result.workflowRunUrl}`)
  return { runId: "", workflowUrl: result.workflowRunUrl }
}
