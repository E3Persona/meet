import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { findContactsForEvent, saveContacts } from "@/lib/contact-finder"

export async function POST() {
  const events = await prisma.event.findMany({
    where: { organizerName: null },
    include: { location: { select: { name: true } }, contacts: true },
    orderBy: { eventDateStart: "asc" },
    take: 20,
  })

  if (events.length === 0) {
    return NextResponse.json({ message: "No events missing contacts", processed: 0, found: 0 })
  }

  console.log(`\n[FindAll] Processing ${events.length} events missing contacts`)

  let totalFound = 0
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    console.log(`[FindAll] ${i + 1}/${events.length}: ${event.eventName}`)

    const foundContacts = await findContactsForEvent(event.eventName, event.sourceUrl, event.location.name)

    const saved = await saveContacts(
      prisma,
      event.id,
      event.contacts,
      foundContacts,
      event.sourceUrl
    )

    totalFound += saved
    console.log(`[FindAll] Found ${saved} new contacts`)
  }

  console.log(`[FindAll] Complete: ${totalFound} total new contacts across ${events.length} events`)

  return NextResponse.json({
    message: `Processed ${events.length} events, found ${totalFound} contacts`,
    processed: events.length,
    found: totalFound,
  })
}
