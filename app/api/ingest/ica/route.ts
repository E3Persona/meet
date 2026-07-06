import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { maxMonths, maxPages, maxLocations, active, fast, dateFrom, dateTo } = body as {
    maxMonths?: number
    maxPages?: number
    maxLocations?: number
    active?: boolean
    fast?: boolean
    dateFrom?: string
    dateTo?: string
  }

  if (active === false) {
    return NextResponse.json({ error: "ICA is disabled via config" }, { status: 409 })
  }

  if (maxMonths !== undefined || maxPages !== undefined || maxLocations !== undefined) {
    await prisma.ingestConfig.upsert({
      where: { scraper: "ica" },
      update: {
        ...(maxMonths !== undefined && { maxMonths }),
        ...(maxPages !== undefined && { maxPages }),
        ...(maxLocations !== undefined && { maxLocations }),
      },
      create: {
        scraper: "ica",
        maxMonths: maxMonths ?? 6,
        maxPages: maxPages ?? 3,
        maxLocations: maxLocations ?? 0,
        active: true,
      },
    })
  }

  const { runId } = await startScraperRun("ingest-ica.ts", "internationalconferencealerts.com", "manual", fast, dateFrom, dateTo)
  return NextResponse.json({ runId, status: "running" })
}
