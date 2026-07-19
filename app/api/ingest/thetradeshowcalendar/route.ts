import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { maxPages, maxLocations, batchSize, batchDelayMs, active, dateFrom, dateTo } = body as {
    maxPages?: number
    maxLocations?: number
    batchSize?: number
    batchDelayMs?: number
    active?: boolean
    dateFrom?: string
    dateTo?: string
  }

  if (active === false) {
    return NextResponse.json({ error: "TheTradeShowCalendar is disabled via config" }, { status: 409 })
  }

  if (maxPages !== undefined || maxLocations !== undefined || batchSize !== undefined || batchDelayMs !== undefined) {
    await prisma.ingestConfig.upsert({
      where: { scraper: "thetradeshowcalendar" },
      update: {
        ...(maxPages !== undefined && { maxPages }),
        ...(maxLocations !== undefined && { maxLocations }),
        ...(batchSize !== undefined && { batchSize }),
        ...(batchDelayMs !== undefined && { batchDelayMs }),
      },
      create: { scraper: "thetradeshowcalendar", maxMonths: 6, maxPages: maxPages ?? 3, maxLocations: maxLocations ?? 0, active: true, batchSize: batchSize ?? 5, batchDelayMs: batchDelayMs ?? 10000 },
    })
  }

  const { runId } = await startScraperRun("ingest-thetradeshowcalendar.ts", "thetradeshowcalendar.com", "manual", false, dateFrom, dateTo)
  return NextResponse.json({ runId, status: "running" })
}
