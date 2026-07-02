import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const DEFAULTS = {
  maxMonths: 6,
  maxPages: 3,
  maxLocations: 0,
  active: true,
} as const

const ALL_SCRAPERS = ["ica", "cn", "aca", "tf", "showsbee", "eventseye"]

export async function GET() {
  const configs = await prisma.ingestConfig.findMany({ orderBy: { scraper: "asc" } })
  return NextResponse.json(configs)
}

export async function PUT(request: Request) {
  const body = await request.json()
  const { configs } = body as {
    configs: Array<{ scraper: string; maxMonths?: number; maxPages?: number; maxLocations?: number; active?: boolean }>
  }

  if (!Array.isArray(configs)) {
    return NextResponse.json({ error: "configs array required" }, { status: 400 })
  }

  const updated = await Promise.all(
    configs.map((c) =>
      prisma.ingestConfig.upsert({
        where: { scraper: c.scraper },
        update: {
          ...(c.maxMonths !== undefined && { maxMonths: c.maxMonths }),
          ...(c.maxPages !== undefined && { maxPages: c.maxPages }),
          ...(c.maxLocations !== undefined && { maxLocations: c.maxLocations }),
          ...(c.active !== undefined && { active: c.active }),
        },
        create: {
          scraper: c.scraper,
          maxMonths: c.maxMonths ?? DEFAULTS.maxMonths,
          maxPages: c.maxPages ?? DEFAULTS.maxPages,
          maxLocations: c.maxLocations ?? DEFAULTS.maxLocations,
          active: c.active ?? DEFAULTS.active,
        },
      })
    )
  )

  return NextResponse.json(updated)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { action } = body as { action: "reset" | "reset-scraper" }
  const { scraper } = body as { scraper?: string }

  if (action === "reset-scraper" && scraper) {
    const reset = await prisma.ingestConfig.upsert({
      where: { scraper },
      update: { maxMonths: DEFAULTS.maxMonths, maxPages: DEFAULTS.maxPages, maxLocations: DEFAULTS.maxLocations, active: DEFAULTS.active },
      create: { scraper, maxMonths: DEFAULTS.maxMonths, maxPages: DEFAULTS.maxPages, maxLocations: DEFAULTS.maxLocations, active: DEFAULTS.active },
    })
    return NextResponse.json(reset)
  }

  if (action === "reset") {
    const allResets = await Promise.all(
      ALL_SCRAPERS.map((s) =>
        prisma.ingestConfig.upsert({
          where: { scraper: s },
          update: { maxMonths: DEFAULTS.maxMonths, maxPages: DEFAULTS.maxPages, maxLocations: DEFAULTS.maxLocations, active: DEFAULTS.active },
          create: { scraper: s, maxMonths: DEFAULTS.maxMonths, maxPages: DEFAULTS.maxPages, maxLocations: DEFAULTS.maxLocations, active: DEFAULTS.active },
        })
      )
    )
    return NextResponse.json(allResets)
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
