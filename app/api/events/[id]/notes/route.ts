import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const { content, noteType, notedAt } = body

  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "Content is required" }, { status: 400 })
  }

  if (!noteType || typeof noteType !== "string") {
    return NextResponse.json({ error: "Note type is required" }, { status: 400 })
  }

  const validNoteTypes = ["general", "contact_attempt", "follow_up", "status_change", "venue_update", "research", "other"]
  if (!validNoteTypes.includes(noteType)) {
    return NextResponse.json({ error: "Invalid note type" }, { status: 400 })
  }

  try {
    const note = await prisma.note.create({
      data: {
        content: content.trim(),
        noteType: noteType as "general" | "contact_attempt" | "follow_up" | "status_change" | "venue_update" | "research" | "other",
        notedAt: notedAt ? new Date(notedAt) : new Date(),
        eventId: id,
      },
    })

    return NextResponse.json(note)
  } catch (error) {
    console.error("Error creating note:", error)
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    const notes = await prisma.note.findMany({
      where: { eventId: id },
      orderBy: { notedAt: "desc" },
    })

    return NextResponse.json(notes)
  } catch (error) {
    console.error("Error fetching notes:", error)
    return NextResponse.json({ error: "Failed to fetch notes" }, { status: 500 })
  }
}
