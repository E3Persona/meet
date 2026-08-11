import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"

function isMetadataObject(value: unknown): value is Prisma.InputJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  if (body.metadata !== undefined && !isMetadataObject(body.metadata)) {
    return NextResponse.json(
      { error: "Metadata must be a JSON object." },
      { status: 400 }
    )
  }

  // Only allow updating organizer fields, status, and contactNote — NEVER auto-populated
  const allowed = {
    organizerName: body.organizerName,
    organizerTitle: body.organizerTitle,
    organizerEmail: body.organizerEmail,
    organizerPhone: body.organizerPhone,
    status: body.status,
    contactNote: body.contactNote,
  }

  // Strip undefined values so we don't overwrite with null accidentally
  const data: Record<string, string | null | Date | Prisma.InputJsonObject> = {}
  for (const [key, value] of Object.entries(allowed)) {
    if (value !== undefined) {
      data[key] = typeof value === "string" ? value.trim() || null : value
    }
  }

  if (body.metadata !== undefined) {
    data.metadata = body.metadata
    data.metadataUpdatedAt = new Date()
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
