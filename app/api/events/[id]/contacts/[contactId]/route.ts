import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// PATCH /api/events/[id]/contacts/[contactId]
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id: eventId, contactId } = await params
  try {
    const body = await request.json()

    // If setting as primary, unset all others first
    if (body.isPrimary === true) {
      await prisma.eventContact.updateMany({
        where: { eventId },
        data: { isPrimary: false },
      })
    }

    const contact = await prisma.eventContact.update({
      where: { id: contactId },
      data: body,
    })

    // Sync Event legacy fields if this is now primary
    if (body.isPrimary === true || contact.isPrimary) {
      await prisma.event.update({
        where: { id: eventId },
        data: {
          organizerName: contact.name,
          organizerTitle: contact.title,
          organizerEmail: contact.email,
          organizerPhone: contact.phone,
        },
      })
    }

    return NextResponse.json(contact)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// DELETE /api/events/[id]/contacts/[contactId]
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactId: string }> }
) {
  const { id: eventId, contactId } = await params
  try {
    const contact = await prisma.eventContact.findUnique({ where: { id: contactId } })
    if (!contact) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.eventContact.delete({ where: { id: contactId } })

    // If deleted contact was primary, promote the next one
    if (contact.isPrimary) {
      const nextPrimary = await prisma.eventContact.findFirst({
        where: { eventId },
        orderBy: { createdAt: "asc" },
      })
      if (nextPrimary) {
        await prisma.eventContact.update({
          where: { id: nextPrimary.id },
          data: { isPrimary: true },
        })
        await prisma.event.update({
          where: { id: eventId },
          data: {
            organizerName: nextPrimary.name,
            organizerTitle: nextPrimary.title,
            organizerEmail: nextPrimary.email,
            organizerPhone: nextPrimary.phone,
          },
        })
      } else {
        // No contacts left — clear legacy fields
        await prisma.event.update({
          where: { id: eventId },
          data: { organizerName: null, organizerTitle: null, organizerEmail: null, organizerPhone: null },
        })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
