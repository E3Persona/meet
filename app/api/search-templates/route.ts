import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const templates = await prisma.searchTemplate.findMany({
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(templates)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { template, active } = body as { template?: string; active?: boolean }

  if (!template?.trim()) {
    return NextResponse.json({ error: "template is required" }, { status: 400 })
  }

  const created = await prisma.searchTemplate.create({
    data: {
      template: template.trim(),
      active: active ?? true,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
