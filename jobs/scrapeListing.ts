import "dotenv/config"
import { prisma } from "../lib/prisma"
import type { EventMatchType, PrismaClient } from "../lib/generated/prisma/client"
import { createJinaProvider } from "../lib/providers/scrape/jina"
import { createPuppeteerProvider } from "../lib/providers/scrape/puppeteer"
import { extractVenueEvents } from "../lib/scrape/venue-llm-extractor"
import { splitIntoBlocks, extractAllDetailUrls, eventNameFromUrl, type RawBlock } from "../lib/scrape/blockSplitter"
import { resolveVenue } from "../lib/venueResolution"
import { extractDetailPageEvents } from "../lib/scrape/venue-llm-extractor"
import { extractDateFromMarkdown } from "../lib/scrape/dateExtractor"
const jina = createJinaProvider()
const puppeteer = createPuppeteerProvider()

const MIN_CONTENT_CHARS = 200
const MAX_PAGES_PER_SOURCE = 10

const CF_ERROR_PATTERNS = [
  "cloudflare",
  "checking your browser",
  "just a moment",
  "enable javascript",
  "attention required",
  "turnstile",
]

function isCloudflareError(text: string): boolean {
  const lower = text.toLowerCase()
  return CF_ERROR_PATTERNS.some((p) => lower.includes(p))
}

async function fetchSingleDetailPage(detailUrl: string): Promise<{ name: string | null; start: Date | null; end: Date | null } | null> {
  const result = await jina.scrape(detailUrl)
  if (!result.markdown) return null
  const text = result.markdown

  const events = await extractDetailPageEvents([{ url: detailUrl, markdown: text }])
  const ev = events[0]
  if (ev?.eventName && ev?.eventDateStart) {
    return {
      name: ev.eventName,
      start: new Date(ev.eventDateStart),
      end: ev.eventDateEnd ? new Date(ev.eventDateEnd) : null,
    }
  }

  const nameMatch = text.match(/^#\s+(.+)$/m)
  const name = nameMatch?.[1]?.trim() ?? ev?.eventName ?? null
  const range = extractDateFromMarkdown(text)
  if (name && range) return { name, start: range.start, end: range.end }
  if (name && !range) return { name, start: null, end: null }
  return null
}

// ─── Pagination detection ─────────────────────────────────────────────────────

interface PaginationResult {
  type: "none" | "query_param" | "path_segment" | "load_more"
  baseUrl: string
  pages: string[]
}

function detectPagination(baseUrl: string, markdown: string): PaginationResult {
  const parsed = new URL(baseUrl)
  const base = `${parsed.origin}${parsed.pathname.replace(/\/$/, "")}`
  const pages: string[] = [baseUrl]

  // Pattern 1: ?page=N, ?p=N, ?pg=N in existing URL
  const qpMatches = markdown.match(/[?&](page|p|pg|offset|start)=(\d+)/g)
  if (qpMatches) {
    const param = qpMatches[0].split("=")[0].replace("?", "").replace("&", "")
    const nums = qpMatches.map((m) => parseInt(m.split("=")[1])).filter((n) => !isNaN(n) && n > 1)
    if (nums.length > 0) {
      const maxPage = Math.max(...nums, 2)
      for (let i = 2; i <= Math.min(maxPage + 1, MAX_PAGES_PER_SOURCE); i++) {
        const url = `${base}?${param}=${i}`
        if (!pages.includes(url)) pages.push(url)
      }
      return { type: "query_param", baseUrl, pages }
    }
  }

  // Pattern 2: /page/N, /p/N, /events/page/2 style paths in markdown
  const pathMatches = markdown.match(/\/(?:page|p|pg|event)[s]?\/(\d+)/gi)
  if (pathMatches) {
    const nums = pathMatches.map((m) => parseInt(m.match(/\d+/)?.[0] ?? "0")).filter((n) => n > 1)
    if (nums.length > 0) {
      const maxPage = Math.min(Math.max(...nums, 2) + 1, MAX_PAGES_PER_SOURCE)
      for (let i = 2; i <= maxPage; i++) {
        const pathBase = base.replace(/\/page\/\d+/, "").replace(/\/p\/\d+/, "").replace(/\/\d+$/, "")
        const url = `${pathBase}/page/${i}`
        if (!pages.includes(url)) pages.push(url)
      }
      return { type: "path_segment", baseUrl, pages }
    }
  }

  // Pattern 3: "Load More" or "Show more" hrefs
  const loadMoreUrls = new Set<string>()
  const loadMoreMatches = markdown.match(/["'](\/[^"']*(?:load.?more|show.?more|more.?events|next)[^"']*)["']/gi)
  if (loadMoreMatches) {
    for (const match of loadMoreMatches) {
      const url = match.replace(/["']/g, "").trim()
      const full = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`
      if (!pages.includes(full) && full.startsWith(base)) {
        loadMoreUrls.add(full)
      }
    }
    // Only use if we found distinct next-page URLs beyond page 1
    const extra = [...loadMoreUrls].filter((u) => !u.includes("page=1") && !u.match(/\/page\/1$/))
    if (extra.length > 0) {
      pages.push(...extra.slice(0, MAX_PAGES_PER_SOURCE - 1))
      return { type: "load_more", baseUrl, pages }
    }
  }

  // Pattern 4: sequential page numbers embedded in hrefs like /events?page=2
  const pageHrefs = markdown.match(/href=["']([^"']*(?:page|p|pg)=[2-9][^"']*)["']/gi)
  if (pageHrefs) {
    const seen = new Set<string>()
    for (const href of pageHrefs) {
      const url = href.replace(/href=["']/g, "").replace(/["']/g, "")
      const full = url.startsWith("http") ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`
      if (full.startsWith(base) && !seen.has(full)) {
        seen.add(full)
      }
    }
    if (seen.size > 0) {
      const sorted = [...seen].sort((a, b) => a.localeCompare(b))
      pages.push(...sorted.slice(0, MAX_PAGES_PER_SOURCE - 1))
      return { type: "query_param", baseUrl, pages }
    }
  }

  return { type: "none", baseUrl, pages }
}

// ─── Fetch with fallback ─────────────────────────────────────────────────────

async function fetchPage(url: string, timeout = 30000): Promise<{ markdown: string; fromCache: boolean; cloudflare: boolean }> {
  // Try Jina first
  const jinaResult = await jina.scrape(url, { timeout })
  if (jinaResult.markdown && jinaResult.markdown.length >= MIN_CONTENT_CHARS) {
    const cf = isCloudflareError(jinaResult.markdown)
    return { markdown: jinaResult.markdown, fromCache: false, cloudflare: cf }
  }

  // Low content or CF suspicion — try Puppeteer
  const pupResult = await puppeteer.scrape(url, { timeout })
  if (pupResult.markdown && pupResult.markdown.length >= MIN_CONTENT_CHARS) {
    return { markdown: pupResult.markdown, fromCache: false, cloudflare: false }
  }

  // Both failed — return what Jina gave us (may be short but useful for dedup)
  return {
    markdown: jinaResult.markdown ?? pupResult.error ?? "",
    fromCache: false,
    cloudflare: isCloudflareError(jinaResult.error ?? pupResult.error ?? ""),
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const parentRunId = process.env.RUN_ID ?? null
  const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
  const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

  // Own IngestionRun for tracking; use parentRunId for events if provided
  const ingestionRun = await prisma.ingestionRun.create({
    data: {
      trigger: process.env.CRON ? "scheduled" : "manual",
      status: "running",
      providersUsed: { venues: "jina+puppeteer" },
    },
  })

  // If RUN_ID looks like a real cuid (not "venues-listing"), use it for events
  const eventRunId = parentRunId && parentRunId.length > 20 ? parentRunId : ingestionRun.id

  console.log(`[scrapeListing] Run ${ingestionRun.id} started (parent=${parentRunId ?? "none"}, events will use=${eventRunId})`)

  const sources = await prisma.venueDirectorySource.findMany({
    where: {
      isActive: true,
      healthStatus: { in: ["valid", "unconfirmed"] },
      strategy: { in: ["jina_markdown", "puppeteer_html"] },
      sourceUrl: { not: null },
      OR: [{ nextCheckAt: { lte: new Date() } }, { nextCheckAt: null }],
    },
    include: {
      directory: { select: { baseUrl: true, type: true, name: true } },
      venue: { select: { id: true, name: true, city: true, state: true, parentId: true } },
    },
    take: 20,
  })

  console.log(`[scrapeListing] ${sources.length} sources due for scraping`)

  let totalFound = 0
  let totalNew = 0
  let totalSkipped = 0
  let totalErrors = 0
  let totalPages = 0
  let totalCloudflare = 0

  for (const source of sources) {
    console.log(`\n[scrapeListing] Source: ${source.sourceUrl}`)
    try {
      const result = await scrapeSource(prisma, source, eventRunId, dateFrom, dateTo)
      totalFound += result.found
      totalNew += result.new
      totalSkipped += result.skipped
      totalPages += result.pages
      if (result.cloudflare) totalCloudflare++
    } catch (err) {
      totalErrors++
      console.error(`[scrapeListing] Fatal error for ${source.sourceUrl}:`, err instanceof Error ? err.message : err)
    }
  }

  await prisma.ingestionRun.update({
    where: { id: ingestionRun.id },
    data: {
      status: totalErrors === sources.length && sources.length > 0 ? "failed" : "success",
      finishedAt: new Date(),
      recordsFound: totalFound,
      recordsNew: totalNew,
    },
  })

  console.log(`\n[scrapeListing] ═══════════════════════════════════════`)
  console.log(`[scrapeListing]  Run ${ingestionRun.id} complete`)
  console.log(`[scrapeListing]   Found:       ${totalFound}`)
  console.log(`[scrapeListing]   New:         ${totalNew}`)
  console.log(`[scrapeListing]   Skipped:     ${totalSkipped}`)
  console.log(`[scrapeListing]   Pages:       ${totalPages}`)
  console.log(`[scrapeListing]   Cloudflare:  ${totalCloudflare}`)
  console.log(`[scrapeListing]   Errors:      ${totalErrors}`)
  console.log(`[scrapeListing] ═══════════════════════════════════════\n`)
}

// ─── Per-source scrape ────────────────────────────────────────────────────────

async function scrapeSource(
  prisma: PrismaClient,
  source: {
    id: string
    sourceUrl: string | null
    directoryId: string
    venueId: string
    batchSize: number
    lastFullHash: string | null
    directory: { baseUrl: string; type: string; name: string }
    venue: { id: string; name: string; city: string | null; state: string | null; parentId: string | null }
  },
  runId: string,
  dateFrom: Date | null,
  dateTo: Date | null
): Promise<{ found: number; new: number; skipped: number; pages: number; cloudflare: boolean }> {
  // Fetch first page
  const sourceUrl = source.sourceUrl!
  const first = await fetchPage(sourceUrl)
  let allMarkdown = first.markdown
  let cloudflareDetected = first.cloudflare
  let pagesFetched = 1

  // Detect pagination from first page
  const pagination = detectPagination(sourceUrl, allMarkdown)

  if (pagination.type !== "none") {
    console.log(`[scrapeListing]   Pagination detected: ${pagination.type}`)
    const maxPages = Math.min(source.batchSize || MAX_PAGES_PER_SOURCE, MAX_PAGES_PER_SOURCE)
    for (let i = 1; i < pagination.pages.length && pagesFetched < maxPages; i++) {
      const pageUrl = pagination.pages[i]
      if (pageUrl === sourceUrl) continue
      process.stdout.write(`[scrapeListing]   fetching page ${i + 1}: ${pageUrl} ... `)
      const result = await fetchPage(pageUrl)
      if (result.markdown.length >= MIN_CONTENT_CHARS) {
        allMarkdown += `\n\n---\n\n## Page ${i + 1}\n\n` + result.markdown
        pagesFetched++
        process.stdout.write(`ok (${result.markdown.length} chars)\n`)
      } else {
        process.stdout.write(`skip (${result.markdown.length} chars)\n`)
        break
      }
    }
  }

  // Full-listing hash dedup
  const listingHash = hashString(allMarkdown)
  if (source.lastFullHash && source.lastFullHash === listingHash) {
    console.log(`[scrapeListing]   No change — skipping`)
    await prisma.venueDirectorySource.update({
      where: { id: source.id },
      data: { lastScrapedAt: new Date(), nextCheckAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    })
    return { found: 0, new: 0, skipped: 0, pages: pagesFetched, cloudflare: cloudflareDetected }
  }

  // Split into blocks (per-event chunks)
  const { blocks } = splitIntoBlocks(allMarkdown, source.directory.baseUrl)

  // Block-level dedup
  const existingBlocks = await prisma.seenBlock.findMany({
    where: { sourceId: source.id },
    select: { blockHash: true, identityKey: true, id: true },
  })
  const existingBlockHashes = new Set(existingBlocks.map((b) => b.blockHash))
  const existingIdentityKeyToId = new Map(existingBlocks.map((b) => [b.identityKey, b.id]))

  const unseenBlocks = blocks.filter((b) => !existingBlockHashes.has(b.blockHash))

  console.log(
    `[scrapeListing]   ${blocks.length} total blocks, ${unseenBlocks.length} unseen across ${pagesFetched} page(s)`
  )

  let found = 0
  let newEvts = 0
  let skipped = 0

  for (const block of unseenBlocks) {
    found++

    const identityKey = block.identityKey || hashFallback(block.rawText)
    const existingBlockIdForIdentity = existingIdentityKeyToId.get(identityKey)

    let existingEventId: string | null = null
    if (existingBlockIdForIdentity) {
      const ev = await prisma.event.findFirst({
        where: { seenBlockId: existingBlockIdForIdentity },
        select: { id: true },
      })
      if (ev) {
        existingEventId = ev.id
        await prisma.seenBlock.update({
          where: { id: existingBlockIdForIdentity },
          data: { blockHash: block.blockHash, lastSeenAt: new Date() },
        })
      }
    }

    const llmEvents = await extractVenueEvents(block.rawText, sourceUrl, source.venue.name, block.dateText, source.venue.city, block.slugName)
    const llmEvent = llmEvents.find((e) => e.eventName && e.eventDateStart) ?? llmEvents[0]

    let eventName = llmEvent?.eventName ?? null
    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    let sourceUrlForEvent = block.detailUrl ?? sourceUrl
    let resolvedLocationId = source.venueId
    let resolvedVenueId: string | null = source.venueId
    let resolvedMatchType: EventMatchType = "venue_matched_from_source"
    let resolvedRawVenueText: string | null = null
    let resolvedRawLocationText: string | null = null
    let skipBlock = false

    // Try detail page when LLM returns no name or low confidence
    if ((!eventName || llmEvent.confidence === "low") && block.detailUrl) {
      const detail = await fetchSingleDetailPage(block.detailUrl)
      if (detail?.name) {
        eventName = detail.name
        eventDateStart = detail.start
        eventDateEnd = detail.end
        sourceUrlForEvent = block.detailUrl
      }
    }

    if (!eventName) { skipBlock = true }

    if (!skipBlock) {
      if (llmEvent?.eventDateStart && !eventDateStart) {
        const d = new Date(llmEvent.eventDateStart)
        if (!isNaN(d.getTime())) eventDateStart = d
      }
      if (llmEvent?.eventDateEnd && !eventDateEnd) {
        const d = new Date(llmEvent.eventDateEnd)
        if (!isNaN(d.getTime())) eventDateEnd = d
      }

      // Detail page date fallback if LLM had name but no dates
      if (!eventDateStart && block.detailUrl) {
        const detail = await fetchSingleDetailPage(block.detailUrl)
        if (detail) {
          eventDateStart ??= detail.start
          eventDateEnd ??= detail.end
          eventName ??= detail.name
          sourceUrlForEvent = block.detailUrl
        }
      }

      // Convention center → city resolution
      const resolved = await resolveVenue({
        rawVenueText: block.venueText,
        rawCityText: llmEvent?.city ?? null,
        rawStateText: null,
        venueIdFromSource: source.venueId,
        directoryType: source.directory.type,
        prisma,
      })

      resolvedLocationId = resolved.locationId ?? source.venueId
      resolvedVenueId = resolved.venueId ?? source.venueId
      resolvedMatchType = resolved.matchType
      resolvedRawVenueText = resolved.rawVenueText
      resolvedRawLocationText = resolved.rawLocationText

      if (resolved.matchType === "unmatched" || !resolvedLocationId) {
        skipBlock = true
      }
    }

    if (skipBlock) {
      await upsertSeenBlock(prisma, source.id, block, identityKey)
      skipped++
      continue
    }

    if (dateFrom && eventDateStart && eventDateStart < dateFrom) { skipped++; continue }
    if (dateTo && eventDateStart && eventDateStart > dateTo) { skipped++; continue }

    if (existingEventId) {
      await prisma.event.update({
        where: { id: existingEventId },
        data: {
          eventName: eventName!,
          eventDateStart,
          eventDateEnd,
          sourceUrl: sourceUrlForEvent,
          sourceUrlIsListingFallback: sourceUrlForEvent === sourceUrl,
        },
      })
      continue
    }

    const seenBlock = await upsertSeenBlock(prisma, source.id, block, identityKey)

    const existingDup = await prisma.event.findFirst({
      where: {
        eventName: { equals: eventName!, mode: "insensitive" },
        locationId: resolvedLocationId,
        eventDateStart: eventDateStart ?? undefined,
      },
    })
    if (existingDup) {
      skipped++
      continue
    }

    await prisma.event.create({
      data: {
        locationId: resolvedLocationId,
        venueId: resolvedVenueId,
        matchType: resolvedMatchType,
        rawVenueText: resolvedRawVenueText,
        rawLocationText: resolvedRawLocationText,
        eventName: eventName!,
        eventDateStart,
        eventDateEnd,
        sourceUrl: sourceUrlForEvent,
        sourceUrlIsListingFallback: !block.detailUrl,
        seenBlockId: seenBlock.id,
        runId,
        status: "new",
      },
    })

    newEvts++
    console.log(`[scrapeListing]   + "${eventName}" → loc=${resolvedLocationId} match=${resolvedMatchType}`)
  }

  // Detail-page scrape pass: extract all detail URLs and scrape any not already saved
  const allDetailUrls = extractAllDetailUrls(allMarkdown)
  if (allDetailUrls.length > blocks.length * 2) {
    const existingEventsForSource = await prisma.event.findMany({
      where: { locationId: source.venueId, sourceUrl: { in: allDetailUrls } },
      select: { sourceUrl: true },
    })
    const alreadySaved = new Set(existingEventsForSource.map((e) => e.sourceUrl))
    const unseenUrls = allDetailUrls.filter((u) => !alreadySaved.has(u))

    if (unseenUrls.length > 0) {
      console.log(`[scrapeListing]   Detail-page pass: ${unseenUrls.length} unseen URLs`)
      let detailNew = 0
      let detailSkipped = 0
      const pageContents = await Promise.all(
        unseenUrls.map(async (url) => {
          const result = await jina.scrape(url)
          return { url, markdown: result.markdown ?? "" }
        })
      )
      const validPages = pageContents.filter((p) => p.markdown.length > 100)
      const llmResults = await extractDetailPageEvents(validPages)
      const detailByUrl = new Map(llmResults.map((e) => [e.url, e]))
      for (const url of unseenUrls) {
        const llmDetail = detailByUrl.get(url)
        const pageContent = validPages.find((p) => p.url === url)
        let detail = llmDetail?.eventName && llmDetail?.eventDateStart
          ? llmDetail
          : null
        if (!detail && pageContent) {
          const nameMatch = pageContent.markdown.match(/^#\s+(.+)$/m)
          const name = nameMatch?.[1]?.trim() ?? null
          const range = extractDateFromMarkdown(pageContent.markdown)
          if (name && range) {
            detail = { url, eventName: name, eventDateStart: range.start.toISOString().slice(0, 10), eventDateEnd: range.end.toISOString().slice(0, 10) }
          }
        }
        if (!detail) { detailSkipped++; continue }
        if (!detail?.eventName || !detail.eventDateStart) { detailSkipped++; continue }
        const start = new Date(detail.eventDateStart)
        if (isNaN(start.getTime())) { detailSkipped++; continue }
        const end = detail.eventDateEnd ? new Date(detail.eventDateEnd) : null
        const existingDup = await prisma.event.findFirst({
          where: {
            eventName: { equals: detail.eventName, mode: "insensitive" },
            locationId: source.venueId,
            eventDateStart: start,
          },
        })
        if (existingDup) { detailSkipped++; continue }

        await prisma.event.create({
          data: {
            locationId: source.venueId,
            venueId: source.venueId,
            matchType: "venue_matched_from_source",
            eventName: detail.eventName,
            eventDateStart: start,
            eventDateEnd: end,
            sourceUrl: url,
            sourceUrlIsListingFallback: false,
            runId,
            status: "new",
            extractionMethod: "jina_markdown",
          },
        })
        detailNew++
        console.log(`[scrapeListing]   + [detail] "${detail.eventName}" | ${start.toISOString().slice(0, 10)}`)
      }
      found += unseenUrls.length
      newEvts += detailNew
      skipped += detailSkipped
      console.log(`[scrapeListing]   Detail pass: ${detailNew} new, ${detailSkipped} skipped`)
    }
  }

  const nextInterval = cloudflareDetected ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  await prisma.venueDirectorySource.update({
    where: { id: source.id },
    data: {
      lastFullHash: listingHash,
      lastScrapedAt: new Date(),
      nextCheckAt: new Date(Date.now() + nextInterval),
      healthStatus: cloudflareDetected ? "broken" : "valid",
    },
  })

  return { found, new: newEvts, skipped, pages: pagesFetched, cloudflare: cloudflareDetected }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function upsertSeenBlock(
  prisma: PrismaClient,
  sourceId: string,
  block: RawBlock,
  identityKey: string
) {
  return prisma.seenBlock.upsert({
    where: { sourceId_blockHash: { sourceId, blockHash: block.blockHash } },
    create: { sourceId, blockHash: block.blockHash, identityKey },
    update: { lastSeenAt: new Date() },
  })
}

function hashString(s: string): string {
  let hash = 5381
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i)
    hash = hash >>> 0
  }
  return hash.toString(16)
}

function hashFallback(text: string): string {
  return hashString(text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 200))
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main()
  .catch((e) => { console.error("[scrapeListing] Fatal:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
