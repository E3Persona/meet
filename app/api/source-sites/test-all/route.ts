import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { scrapeDirectory } from "@/lib/scrape/directory-scraper"

export async function POST() {
  const sites = await prisma.sourceSite.findMany({
    where: {
      active: true,
      sourceSiteConfig: { isNot: null },
    },
    include: { sourceSiteConfig: true },
  })

  if (sites.length === 0) {
    return NextResponse.json({ results: [], message: "No configured sites to test" })
  }

  const results: {
    siteId: string
    siteName: string
    status: string
    totalEvents: number
    errors: string[]
  }[] = []

  for (const site of sites) {
    const config = site.sourceSiteConfig!
    try {
      const result = await scrapeDirectory(config, {})

      const status = result.errors.length === 0
        ? (result.totalEvents > 0 ? "pass" : "partial")
        : (result.totalEvents > 0 ? "partial" : "fail")

      results.push({
        siteId: site.id,
        siteName: site.name,
        status,
        totalEvents: result.totalEvents,
        errors: result.errors,
      })
    } catch (err) {
      results.push({
        siteId: site.id,
        siteName: site.name,
        status: "fail",
        totalEvents: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      })
    }
  }

  return NextResponse.json({ results })
}
