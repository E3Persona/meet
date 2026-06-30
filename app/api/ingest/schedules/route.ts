import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const schedules = await prisma.ingestionSchedule.findMany({
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(schedules)
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { name, cronExpr, locationIds = [], templateIds = [], sourceSiteIds = [] } = body

    if (!name || !cronExpr) {
      return NextResponse.json({ error: "name and cronExpr required" }, { status: 400 })
    }

    const schedule = await prisma.ingestionSchedule.create({
      data: { name, cronExpr, locationIds, templateIds, sourceSiteIds },
    })
    return NextResponse.json(schedule, { status: 201 })
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
