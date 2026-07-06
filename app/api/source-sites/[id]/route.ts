import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { name, url, active, scrapeMode, urlPattern, notes, sourceMode, manualCheckFrequencyDays } = body as {
    name?: string
    url?: string
    active?: boolean
    scrapeMode?: string
    urlPattern?: string
    notes?: string
    sourceMode?: "automated" | "manual"
    manualCheckFrequencyDays?: number
  }

  const updated = await prisma.sourceSite.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(url !== undefined && { url: url?.trim() || null }),
      ...(active !== undefined && { active }),
      ...(scrapeMode !== undefined && { scrapeMode: scrapeMode as "auto" | "calendar" | "directory" | "search" | "skip" }),
      ...(urlPattern !== undefined && { urlPattern: urlPattern?.trim() || null }),
      ...(notes !== undefined && { notes: notes?.trim() || null }),
      ...(sourceMode !== undefined && { sourceMode }),
      ...(manualCheckFrequencyDays !== undefined && { manualCheckFrequencyDays }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.sourceSite.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
