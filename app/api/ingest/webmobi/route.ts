import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"

export async function POST() {
  const { runId } = await startScraperRun("ingest-webmobi.ts", "Webmobi Discovery", "manual")
  return NextResponse.json({ runId, status: "running" })
}
