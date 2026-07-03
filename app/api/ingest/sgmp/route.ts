import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { maxMonths, active } = body as {
    maxMonths?: number
    active?: boolean
  }

  if (active === false) {
    return NextResponse.json({ error: "SGMP is disabled via config" }, { status: 409 })
  }

  if (maxMonths !== undefined) {
    await prisma.ingestConfig.upsert({
      where: { scraper: "sgmp" },
      update: {
        ...(maxMonths !== undefined && { maxMonths }),
      },
      create: { scraper: "sgmp", maxMonths: maxMonths ?? 12, maxPages: 0, maxLocations: 0, active: true },
    })
  }

  const { runId } = await startScraperRun("ingest-sgmp.ts", "sgmp.org")
  return NextResponse.json({ runId, status: "running" })
}
