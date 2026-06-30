import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const schedule = await prisma.ingestionSchedule.update({ where: { id }, data: body })
    return NextResponse.json(schedule)
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await prisma.ingestionSchedule.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
