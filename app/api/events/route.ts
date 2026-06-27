import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get("locationId")
  const status = searchParams.get("status")
  const search = searchParams.get("search")

  const where: Record<string, unknown> = {}

  if (locationId) where.locationId = locationId
  if (status) where.status = status
  if (search) {
    where.OR = [
      { eventName: { contains: search, mode: "insensitive" } },
      { organizerName: { contains: search, mode: "insensitive" } },
      { organizerEmail: { contains: search, mode: "insensitive" } },
    ]
  }

  const events = await prisma.event.findMany({
    where,
    include: { location: { select: { name: true, city: true, state: true } } },
    orderBy: { eventDateStart: "asc" },
  })

  return NextResponse.json(events)
}
