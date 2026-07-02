import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { scrapeDirectory, type SourceSiteConfigInput } from "@/lib/scrape/directory-scraper"

const CONFIG_KEYS: (keyof SourceSiteConfigInput)[] = [
  "paginationType", "paginationParam", "paginationStart", "maxPages",
  "listingUrlTemplate",
  "selectorEventContainer", "selectorEventName",
  "selectorEventDateStart", "selectorEventDateEnd", "selectorEventUrl",
  "selectorVenue", "selectorCity",
  "followDetailPage", "firecrawlFallback", "aiFallback",
  "selectorDetailOrganizer", "selectorDetailEmail",
  "selectorDetailPhone",
]

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))

  const site = await prisma.sourceSite.findUnique({
    where: { id },
    include: { sourceSiteConfig: true },
  })

  if (!site) {
    return NextResponse.json({ error: "Source site not found" }, { status: 404 })
  }

  // Use inline config from the request body if provided, otherwise fall back to DB
  const hasInlineConfig = CONFIG_KEYS.some((k) => k in body)
  let cfg: SourceSiteConfigInput

  if (hasInlineConfig) {
    cfg = {
      paginationType: body.paginationType ?? "none",
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
      firecrawlFallback: body.firecrawlFallback ?? true,
      aiFallback: body.aiFallback ?? false,
      selectorDetailOrganizer: body.selectorDetailOrganizer ?? null,
      selectorDetailEmail: body.selectorDetailEmail ?? null,
      selectorDetailPhone: body.selectorDetailPhone ?? null,
    }
  } else {
    if (!site.sourceSiteConfig) {
      return NextResponse.json({ error: "No config saved yet — fill in selectors and test before saving" }, { status: 400 })
    }
    cfg = site.sourceSiteConfig
  }

  const result = await scrapeDirectory(cfg, {
    city: body.city ?? undefined,
    month: body.month ?? undefined,
    year: body.year ?? undefined,
  })

  const useDetail = cfg.followDetailPage
  const allEvents = result.pages.flatMap((p) => useDetail && p.detailEvents.length > 0 ? p.detailEvents : p.events)
  const preview = allEvents.slice(0, 3).map((e) => ({
    name: e.eventName,
    dateStart: e.eventDateStart,
    dateEnd: e.eventDateEnd,
    url: e.sourceUrl,
  }))

  return NextResponse.json({
    siteId: id,
    siteName: site.name,
    totalPages: result.pages.length,
    totalContainers: result.totalContainers,
    totalEvents: result.totalEvents,
    pages: result.pages.map((p) => ({
      url: p.url,
      pageNum: p.pageNum,
      fetchMethod: p.fetchMethod,
      containersFound: p.events.length,
      eventsExtracted: useDetail ? p.detailEvents.length : p.events.length,
      aiEvents: p.aiEvents.length,
    })),
    preview,
    errors: result.errors,
    firecrawlFallbackUsed: result.firecrawlFallbackUsed,
    aiFallbackUsed: result.aiFallbackUsed,
  })
}
