import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { maxPages, maxLocations, active, dateFrom, dateTo } = body as {
    maxPages?: number
    maxLocations?: number
    active?: boolean
    dateFrom?: string
    dateTo?: string
  }

  if (active === false) {
    return NextResponse.json({ error: "BlackMeetings is disabled via config" }, { status: 409 })
  }

  if (maxPages !== undefined || maxLocations !== undefined) {
    await prisma.ingestConfig.upsert({
      where: { scraper: "blackmeetings" },
      update: {
        ...(maxPages !== undefined && { maxPages }),
        ...(maxLocations !== undefined && { maxLocations }),
      },
      create: { scraper: "blackmeetings", maxMonths: 6, maxPages: maxPages ?? 3, maxLocations: maxLocations ?? 0, active: true },
    })
  }

  const { runId } = await startScraperRun("ingest-blackmeetings.ts", "blackmeetingsandtourism.com", "manual", false, dateFrom, dateTo)
  return NextResponse.json({ runId, status: "running" })
}
