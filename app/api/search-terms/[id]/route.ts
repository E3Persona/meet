import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { keyword, active } = body as { keyword?: string; active?: boolean }

  const term = await prisma.searchTerm.update({
    where: { id },
    data: {
      ...(keyword !== undefined && { keyword: keyword.trim() }),
      ...(active !== undefined && { active }),
    },
  })

  return NextResponse.json(term)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.searchTerm.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
