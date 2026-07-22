import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(request: Request) {
  const body = await request.json()
  const { ids, sourceUrl, isActive, healthStatus } = body as {
    ids: string[]
    sourceUrl?: string
    isActive?: boolean
    healthStatus?: string
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (sourceUrl !== undefined) data.sourceUrl = sourceUrl
  if (isActive !== undefined) data.isActive = isActive
  if (healthStatus !== undefined) data.healthStatus = healthStatus

  await prisma.venueDirectorySource.updateMany({
    where: { id: { in: ids } },
    data,
  })

  return NextResponse.json({ ok: true, updated: ids.length })
}
