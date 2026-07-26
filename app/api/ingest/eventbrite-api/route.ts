import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"

export async function POST() {
  const { runId } = await startScraperRun("ingest-eventbrite-api.ts", "Eventbrite API", "manual")
  return NextResponse.json({ runId, status: "running" })
}
