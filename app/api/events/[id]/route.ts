import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  // Only allow updating organizer fields and status — NEVER auto-populated
  const allowed = {
    organizerName: body.organizerName,
    organizerTitle: body.organizerTitle,
    organizerEmail: body.organizerEmail,
    organizerPhone: body.organizerPhone,
    status: body.status,
  }

  // Strip undefined values so we don't overwrite with null accidentally
  const data: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(allowed)) {
    if (value !== undefined) {
      data[key] = typeof value === "string" ? value.trim() || null : value
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const event = await prisma.event.update({
    where: { id },
    data,
    include: { location: { select: { name: true } } },
  })

  return NextResponse.json(event)
}
