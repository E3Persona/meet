import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const locations = await prisma.location.findMany({
    include: { searchTerms: { orderBy: { keyword: "asc" } } },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(locations)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, address, city, state, sourceUrl, searchTerms } = body as {
    name: string
    address?: string
    city?: string
    state?: string
    sourceUrl?: string
    searchTerms?: string[]
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }

  const location = await prisma.location.create({
    data: {
      name: name.trim(),
      address: address?.trim() || null,
      city: city?.trim() || null,
      state: state?.trim() || null,
      sourceUrl: sourceUrl?.trim() || null,
      searchTerms: {
        create: (searchTerms ?? []).map((keyword) => ({ keyword })),
      },
    },
    include: { searchTerms: true },
  })

  return NextResponse.json(location, { status: 201 })
}
