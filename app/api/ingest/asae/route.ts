import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { active, dateFrom, dateTo } = body as {
    active?: boolean
    dateFrom?: string
    dateTo?: string
  }

  if (active === false) {
    return NextResponse.json({ error: "ASAE is disabled via config" }, { status: 409 })
  }

  const { runId } = await startScraperRun("ingest-asae.ts", "asaecenter.org", "manual", false, dateFrom, dateTo)
  return NextResponse.json({ runId, status: "running" })
}
