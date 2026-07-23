import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { active } = body as { active?: boolean }

  if (active === false) {
    return NextResponse.json({ error: "Philadelphia Union scraper is disabled via config" }, { status: 409 })
  }

  const { runId } = await startScraperRun("ingest-philadelphiaunion.ts", "https://www.philadelphiaunion.com/stadium/non-philadelphia-union-events", "manual")
  return NextResponse.json({ runId, status: "running" })
}
