import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { active } = body as { active?: boolean }

  if (active === false) {
    return NextResponse.json({ error: "Gaylord National scraper is disabled via config" }, { status: 409 })
  }

  const { runId } = await startScraperRun("ingest-gaylordnational.ts", "https://tickets.gaylordnational.com/", "manual")
  return NextResponse.json({ runId, status: "running" })
}
