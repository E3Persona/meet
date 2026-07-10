import { NextResponse } from "next/server"
import { getRunProgress } from "@/lib/ingest/progress-store"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const logs = getRunProgress(runId)
  return NextResponse.json({ logs })
}
