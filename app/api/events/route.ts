import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get("locationId")
  const cityId = searchParams.get("cityId")
  const status = searchParams.get("status")
  const search = searchParams.get("search")
  const hasContact = searchParams.get("hasContact") // "true", "false", or null
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "25", 10)))

  const where: Record<string, unknown> = {}

  if (cityId && !locationId) {
    // Find all venues under this city, then match events at those venues
    const venueIds = await prisma.location.findMany({
      where: { type: "VENUE", parentId: cityId },
      select: { id: true },
    })
    where.locationId = { in: venueIds.map((v) => v.id) }
  }

  if (locationId) where.locationId = locationId
  if (status) where.status = status
  const orConditions: Record<string, unknown>[] = []

  if (hasContact === "false") {
    where.NOT = {
      OR: [
        { contacts: { some: {} } },
        { organizerName: { not: null } },
        { organizerEmail: { not: null } },
      ],
    }
  }
  if (search) {
    orConditions.push(
      { eventName: { contains: search, mode: "insensitive" } },
      { organizerName: { contains: search, mode: "insensitive" } },
      { organizerEmail: { contains: search, mode: "insensitive" } },
      { contacts: { some: { name: { contains: search, mode: "insensitive" } } } },
      { contacts: { some: { email: { contains: search, mode: "insensitive" } } } },
    )
  }
  if (hasContact === "true") {
    orConditions.push(
      { contacts: { some: {} } },
      { organizerName: { not: null } },
      { organizerEmail: { not: null } },
    )
  }
  if (orConditions.length > 0) {
    where.OR = orConditions
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
