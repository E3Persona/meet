import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"

export async function POST() {
  const { runId } = await startScraperRun("ingest-bigevent.ts", "BigEvent.io", "manual")
  return NextResponse.json({ runId, status: "running" })
}
