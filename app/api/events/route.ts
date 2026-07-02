import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get("locationId")
  const status = searchParams.get("status")
  const search = searchParams.get("search")
  const hasContact = searchParams.get("hasContact") // "true", "false", or null
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "25", 10)))

  const where: Record<string, unknown> = {}

  if (locationId) where.locationId = locationId
  if (status) where.status = status
  if (hasContact === "true") {
    where.contacts = { some: {} }
  } else if (hasContact === "false") {
    where.contacts = { none: {} }
  }
  if (search) {
    where.OR = [
      { eventName: { contains: search, mode: "insensitive" } },
      { organizerName: { contains: search, mode: "insensitive" } },
      { organizerEmail: { contains: search, mode: "insensitive" } },
      { contacts: { some: { name: { contains: search, mode: "insensitive" } } } },
      { contacts: { some: { email: { contains: search, mode: "insensitive" } } } },
    ]
  }

  const [events, total] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        location: { select: { name: true, city: true, state: true } },
        contacts: {
          select: { id: true, name: true, isPrimary: true, email: true, phone: true, title: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        },
      },
      orderBy: { eventDateStart: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.event.count({ where }),
  ])

  return NextResponse.json({ events, total, page, pageSize })
}

export async function DELETE() {
  const count = await prisma.event.deleteMany({})
  return NextResponse.json({ deleted: count.count })
}
