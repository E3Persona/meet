import { NextResponse } from "next/server"
import { prisma, withRetry } from "@/lib/prisma"

export async function GET() {
  const locations = await withRetry(() =>
    prisma.location.findMany({
      include: {
        searchTerms: { orderBy: { keyword: "asc" } },
        venues: { where: { active: true }, select: { id: true, name: true, shortName: true } },
        parent: { select: { id: true, name: true } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    })
  )
  return NextResponse.json(locations)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, address, city, state, sourceUrl, searchTerms, type, parentId } = body as {
    name: string
    address?: string
    city?: string
    state?: string
    sourceUrl?: string
    searchTerms?: string[]
    type?: "CITY" | "VENUE"
    parentId?: string
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  // Resolve parentId — if it looks like a city name (not a cuid), look it up
  let resolvedParentId = parentId?.trim() || null
  if (resolvedParentId && !resolvedParentId.startsWith("c")) {
    const city = await prisma.location.findFirst({
      where: { type: "CITY", name: resolvedParentId },
      select: { id: true },
    })
    if (city) {
      resolvedParentId = city.id
    } else {
      resolvedParentId = null
    }
  }

  const location = await prisma.location.create({
    data: {
      type: type ?? "VENUE",
      name: name.trim(),
      address: address?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      sourceUrl: sourceUrl?.trim() || null,
      parentId: resolvedParentId,
      searchTerms: {
        create: (searchTerms ?? []).map((keyword) => ({ keyword })),
      },
    },
    include: { searchTerms: true },
  })

  return NextResponse.json(location, { status: 201 })
}
