import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { maxPages, active } = body as { maxPages?: number; active?: boolean }

  if (active === false) {
    return NextResponse.json({ error: "TradeFairDates scraper is disabled via config" }, { status: 409 })
  }

  if (maxPages !== undefined) {
    await prisma.ingestConfig.upsert({
      where: { scraper: "tradefairdates" },
      update: { maxPages },
      create: { scraper: "tradefairdates", maxMonths: 12, maxPages, active: true },
    })
  }

  const { runId } = await startScraperRun("ingest-tradefairdates.ts", "https://www.tradefairdates.com/Fairs-USA-Z228-S1.html", "manual")
  return NextResponse.json({ runId, status: "running" })
}
