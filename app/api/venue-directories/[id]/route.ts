import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const source = await prisma.venueDirectorySource.findUnique({
    where: { id },
    include: {
      venue: { select: { id: true, name: true, city: true, state: true } },
      directory: { select: { id: true, baseUrl: true, name: true } },
    },
  })
  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  return NextResponse.json(source)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const {
    sourceUrl,
    isActive,
    healthStatus,
    suggestedUrl,
    discoveryMethod,
    discoveryConfidence,
    batchSize,
    batchDelayMs,
    strategy,
  } = body as Partial<{
    sourceUrl: string
    isActive: boolean
    healthStatus: string
    suggestedUrl: string
    discoveryMethod: string
    discoveryConfidence: number
    batchSize: number
    batchDelayMs: number
    strategy: string
  }>

  const data: Record<string, unknown> = {}
  if (sourceUrl !== undefined) data.sourceUrl = sourceUrl
  if (isActive !== undefined) data.isActive = isActive
  if (healthStatus !== undefined) data.healthStatus = healthStatus
  if (suggestedUrl !== undefined) data.suggestedUrl = suggestedUrl
  if (discoveryMethod !== undefined) data.discoveryMethod = discoveryMethod
  if (discoveryConfidence !== undefined) data.discoveryConfidence = discoveryConfidence
  if (batchSize !== undefined) data.batchSize = batchSize
  if (batchDelayMs !== undefined) data.batchDelayMs = batchDelayMs
  if (strategy !== undefined) data.strategy = strategy

  const updated = await prisma.venueDirectorySource.update({
    where: { id },
    data,
    include: {
      venue: { select: { id: true, name: true, city: true, state: true } },
      directory: { select: { id: true, baseUrl: true, name: true } },
    },
  })

  return NextResponse.json(updated)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await prisma.venueDirectorySource.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
