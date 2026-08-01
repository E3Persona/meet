import { NextResponse } from "next/server"
import { prisma, withRetry } from "@/lib/prisma"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const health = searchParams.get("health")
  const active = searchParams.get("active")
  const venueId = searchParams.get("venueId")

  const where: Record<string, unknown> = {}
  if (health) where.healthStatus = health
  if (active !== null) where.isActive = active === "true"
  if (venueId) where.venueId = venueId

  const sources = await withRetry(() =>
    prisma.venueDirectorySource.findMany({
      where,
      include: {
        venue: { select: { id: true, name: true, city: true, state: true, address: true } },
        directory: { select: { id: true, baseUrl: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
    })
  )

  return NextResponse.json(sources)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { sources } = body as { sources?: Array<{
    directoryId: string
    venueId: string
    sourceUrl: string
    strategy?: string
    isActive?: boolean
    healthStatus?: string
    batchSize?: number
    batchDelayMs?: number
  }> }

  if (Array.isArray(sources) && sources.length > 0) {
    const results = await Promise.all(
      sources.map((s) =>
        prisma.venueDirectorySource.upsert({
          where: {
            directoryId_venueId_sourceUrl: {
              directoryId: s.directoryId,
              venueId: s.venueId,
              sourceUrl: s.sourceUrl,
            },
          },
          update: {
            isActive: s.isActive ?? true,
            healthStatus: (s.healthStatus as "unconfirmed") ?? "unconfirmed",
          },
          create: {
            directoryId: s.directoryId,
            venueId: s.venueId,
            sourceUrl: s.sourceUrl,
            strategy: (s.strategy as "jina_markdown") ?? "jina_markdown",
            isActive: s.isActive ?? true,
            healthStatus: (s.healthStatus as "unconfirmed") ?? "unconfirmed",
            batchSize: s.batchSize ?? 5,
            batchDelayMs: s.batchDelayMs ?? 10000,
          },
        })
      )
    )
    return NextResponse.json(results, { status: 201 })
  }

  const { directoryId, venueId, sourceUrl, strategy, isActive, healthStatus } = body as {
    directoryId?: string
    venueId?: string
    sourceUrl?: string
    strategy?: string
    isActive?: boolean
    healthStatus?: string
  }

  if (!directoryId || !venueId || !sourceUrl) {
    return NextResponse.json({ error: "directoryId, venueId, and sourceUrl are required" }, { status: 400 })
  }

  const created = await prisma.venueDirectorySource.upsert({
    where: {
      directoryId_venueId_sourceUrl: { directoryId, venueId, sourceUrl },
    },
    update: {
      isActive: isActive ?? true,
      ...(healthStatus && { healthStatus: healthStatus as "unconfirmed" }),
    },
    create: {
      directoryId,
      venueId,
      sourceUrl,
      strategy: (strategy as "jina_markdown") ?? "jina_markdown",
      isActive: isActive ?? true,
      healthStatus: (healthStatus as "unconfirmed") ?? "unconfirmed",
    },
  })

  return NextResponse.json(created, { status: 201 })
}
