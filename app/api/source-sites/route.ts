import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const sites = await prisma.sourceSite.findMany({
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(sites)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, url, active, scrapeMode, urlPattern, notes } = body as {
    name?: string
    url?: string
    active?: boolean
    scrapeMode?: string
    urlPattern?: string
    notes?: string
  }

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 })
  }

  const created = await prisma.sourceSite.create({
    data: {
      name: name.trim(),
      url: url?.trim() || null,
      active: active ?? true,
      scrapeMode: (scrapeMode as "auto" | "calendar" | "directory" | "search" | "skip") ?? "auto",
      urlPattern: urlPattern?.trim() || null,
      notes: notes?.trim() || null,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
