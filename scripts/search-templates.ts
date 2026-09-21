import "dotenv/config"
import { prisma } from "../lib/prisma"
import { runSearchTemplates } from "../lib/scrapers/ingest-search-templates"
import { startIngestRun, finishIngestRun } from "../lib/ingest-run"

/*
 * Search-templates cron driver.
 *
 * Runs the round-robin search queue: builds every active template × city/
 * venue × month tuple, ranks never-run/oldest-first, and searches the top
 * batch (default 10). Each hit is scraped and enriched into an Event.
 *
 * This is the scheduled entry point — the cron calls `tsx scripts/
 * search-templates.ts`. The targeted (manual) path lives in the
 * app/api/ingest/search-templates POST route and calls runSearchTemplates
 * directly with explicit IDs.
 *
 * Usage:
 *   pnpm exec tsx scripts/search-templates.ts
 */

async function main() {
  const ctx = await startIngestRun(
    (process.env.TRIGGER as "manual" | "scheduled") ?? "manual"
  )
  console.log(`[SearchTemplates] Starting at ${new Date().toISOString()}`)
  console.log(`[SearchTemplates] Trigger: ${ctx.trigger}`)

  try {
    const summary = await runSearchTemplates({
      runId: ctx.runId,
    })
    console.log("[SearchTemplates] Summary:", summary)
    await finishIngestRun(ctx, {
      recordsFound: summary.searched,
      recordsNew: summary.eventsEnriched,
    })
    process.exit(0)
  } catch (err) {
    console.error("[SearchTemplates] Fatal error:", err)
    await finishIngestRun(ctx, {
      recordsFound: 0,
      recordsNew: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  }
}

main()
  .catch((e) => {
    console.error("[SearchTemplates] Unhandled rejection:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())