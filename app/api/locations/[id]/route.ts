import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { name, address, city, state, sourceUrl, active, type, parentId } = body as {
    name?: string
    address?: string
    city?: string
    state?: string
    sourceUrl?: string
    active?: boolean
    type?: "CITY" | "VENUE"
    parentId?: string | null
  }

  const location = await prisma.location.update({
    where: { id },
    data: {
      ...(name !== undefined && { name: name.trim() }),
      ...(address !== undefined && { address: address?.trim() || null }),
      ...(city !== undefined && { city: city?.trim() || null }),
      ...(state !== undefined && { state: state?.trim() || null }),
      ...(sourceUrl !== undefined && { sourceUrl: sourceUrl?.trim() || null }),
      ...(active !== undefined && { active }),
      ...(type !== undefined && { type }),
      ...(parentId !== undefined && { parentId: parentId ?? null }),
    },
    include: { searchTerms: true },
  })

  return NextResponse.json(location)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.location.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
