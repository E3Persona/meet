import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { findContactsForEvent, saveContacts } from "@/lib/contact-finder"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const event = await prisma.event.findUnique({
    where: { id },
    include: { location: { select: { name: true } }, contacts: true },
  })

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }

  console.log(`\n[FindContact] Finding contacts for: ${event.eventName}`)

  const foundContacts = await findContactsForEvent(
    event.eventName,
    event.sourceUrl,
    event.location.name
  )

  const saved = await saveContacts(
    prisma,
    event.id,
    event.contacts,
    foundContacts,
    event.sourceUrl
  )

  console.log(`[FindContact] Saved ${saved} new contacts (total: ${event.contacts.length + saved})`)

  const allContacts = await prisma.eventContact.findMany({
    where: { eventId: event.id },
    orderBy: [{ isPrimary: "desc" }, { confidence: "desc" }, { createdAt: "asc" }],
  })

  return NextResponse.json({
    eventId: event.id,
    eventName: event.eventName,
    contacts: allContacts,
    newFound: saved,
  })
}
