import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { template, active, scope } = body as {
    template?: string
    active?: boolean
    scope?: "CITY" | "VENUE" | "GLOBAL"
  }

  const updated = await prisma.searchTemplate.update({
    where: { id },
    data: {
      ...(template !== undefined && { template: template.trim() }),
      ...(active !== undefined && { active }),
      ...(scope !== undefined && { scope }),
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.searchTemplate.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
