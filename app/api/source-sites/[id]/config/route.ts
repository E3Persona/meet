import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import type { Prisma } from "@/lib/generated/prisma/client"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const config = await prisma.sourceSiteConfig.findUnique({
    where: { sourceSiteId: id },
  })
  return NextResponse.json(config ?? {})
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const existing = await prisma.sourceSiteConfig.findUnique({
    where: { sourceSiteId: id },
  })
  if (existing) {
    return NextResponse.json({ error: "Config already exists — use PATCH to update" }, { status: 409 })
  }

  const config = await prisma.sourceSiteConfig.create({
    data: {
      sourceSiteId: id,
      paginationType: body.paginationType ?? null,
      paginationParam: body.paginationParam ?? null,
      paginationStart: body.paginationStart ?? 1,
      maxPages: body.maxPages ?? 5,
      listingUrlTemplate: body.listingUrlTemplate ?? null,
      selectorEventContainer: body.selectorEventContainer ?? null,
      selectorEventName: body.selectorEventName ?? null,
      selectorEventDateStart: body.selectorEventDateStart ?? null,
      selectorEventDateEnd: body.selectorEventDateEnd ?? null,
      selectorEventUrl: body.selectorEventUrl ?? null,
      selectorVenue: body.selectorVenue ?? null,
      selectorCity: body.selectorCity ?? null,
      followDetailPage: body.followDetailPage ?? false,
      selectorDetailOrganizer: body.selectorDetailOrganizer ?? null,
      selectorDetailEmail: body.selectorDetailEmail ?? null,
      selectorDetailPhone: body.selectorDetailPhone ?? null,
    },
  })

  return NextResponse.json(config, { status: 201 })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const allowed = [
    "paginationType", "paginationParam", "paginationStart", "maxPages",
    "listingUrlTemplate",
    "selectorEventContainer", "selectorEventName",
    "selectorEventDateStart", "selectorEventDateEnd", "selectorEventUrl",
    "selectorVenue", "selectorCity",
    "followDetailPage", "firecrawlFallback", "aiFallback",
    "selectorDetailOrganizer", "selectorDetailEmail",
    "selectorDetailPhone",
    "lastTestedAt", "lastTestStatus", "lastTestNotes",
  ]

  const data: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) data[key] = body[key]
  }

  const config = await prisma.sourceSiteConfig.upsert({
    where: { sourceSiteId: id },
    create: { sourceSiteId: id, ...data } as Prisma.SourceSiteConfigUncheckedCreateInput,
    update: data,
  })

  return NextResponse.json(config)
}
