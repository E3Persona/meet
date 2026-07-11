import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getRunProgress } from "@/lib/ingest/progress-store"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params
  const logs = getRunProgress(runId)
  const run = await prisma.ingestionRun.findUnique({
    where: { id: runId },
    select: { status: true },
  })
  return NextResponse.json({
    logs,
    finished: !run || run.status !== "running",
    status: run?.status ?? "unknown",
  })
}
