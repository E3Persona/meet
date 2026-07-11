import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"
import { scrapeUrl } from "@/lib/scrapers/generic-llm"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { maxLocations, active, sourceSiteId, url, provider } = body as {
    maxLocations?: number
    active?: boolean
    sourceSiteId?: string
    url?: string
    provider?: string
  }

  if (active === false) {
    return NextResponse.json({ error: "Generic LLM scraping is disabled via config" }, { status: 409 })
  }

  // If a specific source site ID or URL is provided, do a single scrape
  if (sourceSiteId || url) {
    const targetUrl = url || (sourceSiteId ? (await prisma.sourceSite.findUnique({ where: { id: sourceSiteId } }))?.url : null)
    if (!targetUrl) {
      return NextResponse.json({ error: "No URL provided and source site not found" }, { status: 400 })
    }

    try {
      const result = await scrapeUrl(targetUrl, { provider })
      return NextResponse.json({
        status: "success",
        events: result.events,
        title: result.title,
        error: result.error,
      })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // Otherwise do a full run via the ingestion script
  const { runId } = await startScraperRun("ingest-generic-llm.ts", "generic-llm-scraper", "manual")
  return NextResponse.json({ runId, status: "running" })
}
