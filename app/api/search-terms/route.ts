import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function POST(request: Request) {
  const body = await request.json()
  const { keyword, locationId, active } = body as {
    keyword: string
    locationId: string
    active?: boolean
  }

  if (!keyword?.trim() || !locationId) {
    return NextResponse.json(
      { error: "keyword and locationId are required" },
      { status: 400 }
    )
  }

  const term = await prisma.searchTerm.create({
    data: {
      keyword: keyword.trim(),
      locationId,
      active: active ?? true,
    },
  })

  return NextResponse.json(term, { status: 201 })
}
