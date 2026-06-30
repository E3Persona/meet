import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// GET /api/events/[id]/contacts — list contacts for an event
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params
  const contacts = await prisma.eventContact.findMany({
    where: { eventId },
    orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }, { createdAt: "asc" }],
  })
  return NextResponse.json({ contacts })
}

// POST /api/events/[id]/contacts — add a new manual contact
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: eventId } = await params
  try {
    const body = await request.json()
    const { name, title, email, phone } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 })
    }

    // Check if this is the first contact — make it primary
    const existingCount = await prisma.eventContact.count({ where: { eventId } })

    const contact = await prisma.eventContact.create({
      data: {
        eventId,
        name: name.trim(),
        title: title || null,
        email: email || null,
        phone: phone || null,
        isPrimary: existingCount === 0,
        confidence: "manual",
      },
    })

    // Also update the Event's legacy fields if this is the first/primary
    if (existingCount === 0) {
      await prisma.event.update({
        where: { id: eventId },
        data: { organizerName: name.trim(), organizerTitle: title || null, organizerEmail: email || null, organizerPhone: phone || null },
      })
    }

    return NextResponse.json(contact, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
