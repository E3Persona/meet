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

  const run = await prisma.ingestionRun.create({
    data: { trigger, status: "running" },
  })

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

  try {
    const result = await triggerIngestWorkflow({
      scraperScript: scriptName,
      trigger,
      dateFrom,
      dateTo,
      forceRefresh,
      runId: run.id,
    })
    console.log(`[Scraper] Triggered GitHub Actions for "${siteName}": ${result.workflowRunUrl}`)
    return { runId: run.id, workflowUrl: result.workflowRunUrl }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown"
    console.error(`[Scraper] Failed to trigger GitHub Actions for "${siteName}":`, errorMessage)
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), errorMessage },
    })
    throw error
  }
}
