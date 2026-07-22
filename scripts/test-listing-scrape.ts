#!/usr/bin/env npx tsx
/**
 * Test script for the venue listing scraper.
 * Run with: npx tsx scripts/test-listing-scrape.ts [--dry] [--venue-id=VDS_ID] [--url=https://...] [--date-from=2025-01-01] [--date-to=2025-12-31]
 *
 * Examples:
 *   npx tsx scripts/test-listing-scrape.ts                          # run all due sources
 *   npx tsx scripts/test-listing-scrape.ts --url=https://...        # scrape single URL
 *   npx tsx scripts/test-listing-scrape.ts --dry                   # dry run (no DB writes)
 */

import "dotenv/config"
import { prisma } from "../lib/prisma"
import { createJinaProvider } from "../lib/providers/scrape/jina"
import { createPuppeteerProvider } from "../lib/providers/scrape/puppeteer"
import { extractVenueEvents, extractDetailPageEvents } from "../lib/scrape/venue-llm-extractor"
import { splitIntoBlocks, extractAllDetailUrls, eventNameFromUrl, type RawBlock } from "../lib/scrape/blockSplitter"
import { resolveVenue } from "../lib/venueResolution"
import { extractDateFromMarkdown } from "../lib/scrape/dateExtractor"

const jina = createJinaProvider()
const puppeteer = createPuppeteerProvider()

const MIN_CONTENT_CHARS = 200
const CF_ERROR_PATTERNS = ["cloudflare", "checking your browser", "just a moment", "enable javascript", "attention required", "turnstile"]

function isCloudflareError(text: string): boolean {
  return CF_ERROR_PATTERNS.some((p) => text.toLowerCase().includes(p))
}

// ─── Parse CLI args ─────────────────────────────────────────────────────────

function parseArgs() {
  const args: Record<string, string | boolean> = {}
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.startsWith("--") ? arg.slice(2).split("=") : [arg, "true"]
    args[key] = value === "true" ? true : value
  }
  return args
}

// ─── Fetch page ─────────────────────────────────────────────────────────────

async function fetchPage(url: string, timeout = 30000) {
  console.log(`\n[fetch] URL: ${url}`)

  const jinaResult = await jina.scrape(url, { timeout })
  const jinaOk = jinaResult.markdown && jinaResult.markdown.length >= MIN_CONTENT_CHARS && !isCloudflareError(jinaResult.markdown ?? "")
  console.log(`[fetch]   Jina:    ${jinaOk ? "✓" : "✗"} (${jinaResult.markdown?.length ?? 0} chars)${jinaResult.error ? ` — ${jinaResult.error}` : ""}`)

  if (jinaOk) {
    return { markdown: jinaResult.markdown!, provider: "jina", cloudflare: isCloudflareError(jinaResult.markdown ?? "") }
  }

  console.log(`[fetch]   Falling back to Puppeteer...`)
  const pupResult = await puppeteer.scrape(url, { timeout })
  const pupOk = pupResult.markdown && pupResult.markdown.length >= MIN_CONTENT_CHARS
  console.log(`[fetch]   Puppeteer: ${pupOk ? "✓" : "✗"} (${pupResult.markdown?.length ?? 0} chars)${pupResult.error ? ` — ${pupResult.error}` : ""}`)

  return {
    markdown: pupResult.markdown ?? jinaResult.markdown ?? "",
    provider: pupOk ? "puppeteer" : "jina",
    cloudflare: isCloudflareError(pupResult.error ?? jinaResult.error ?? ""),
  }
}

// ─── Show blocks from markdown ─────────────────────────────────────────────

function showBlocks(blocks: RawBlock[]) {
  console.log(`\n[blocks] ${blocks.length} blocks extracted:`)
  for (const block of blocks.slice(0, 10)) {
    const preview = block.rawText.slice(0, 120).replace(/\n/g, " ").trim()
    console.log(`  [${block.blockHash.slice(0, 8)}] "${preview}"${block.rawText.length > 120 ? "..." : ""}`)
  }
  if (blocks.length > 10) console.log(`  ... and ${blocks.length - 10} more`)
}

// ─── Show LLM extraction results ───────────────────────────────────────────

async function fetchDetailPageEvent(detailUrl: string): Promise<{ name: string | null; start: Date | null; end: Date | null } | null> {
  const result = await jina.scrape(detailUrl)
  if (!result.markdown) return null
  const text = result.markdown

  const events = await extractDetailPageEvents([{ url: detailUrl, markdown: text }])
  const ev = events[0]
  if (ev?.eventName && ev?.eventDateStart) {
    return { name: ev.eventName, start: new Date(ev.eventDateStart), end: ev.eventDateEnd ? new Date(ev.eventDateEnd) : null }
  }

  const nameMatch = text.match(/^#\s+(.+)$/m)
  const name = nameMatch?.[1]?.trim() ?? ev?.eventName ?? null
  const range = extractDateFromMarkdown(text)
  if (name && range) return { name, start: range.start, end: range.end }
  return name ? { name, start: null, end: null } : null
}

async function showExtraction(blocks: RawBlock[], venueName: string, sourceUrl: string, cityHint?: string | null) {
  console.log(`\n[llm] Extracting events from ${blocks.length} blocks...`)
  let extracted = 0
  let skipped = 0
  let detailFallback = 0

  for (const block of blocks) {
    const events = await extractVenueEvents(block.rawText, sourceUrl, venueName, block.dateText, cityHint, block.slugName)
    const ev = events.find((e) => e.eventName && e.eventDateStart) ?? events[0]
    if (!ev?.eventName) { skipped++; continue }
    if (ev.confidence === "low") {
      console.log(`  [low-cf] "${ev.eventName}"`)
      // Detail page fallback
      if (block.detailUrl) {
        const detail = await fetchDetailPageEvent(block.detailUrl)
        if (detail?.name) {
          console.log(`    → detail page: "${detail.name}" | ${detail.start?.toISOString().slice(0, 10) ?? "?"} → ${detail.end?.toISOString().slice(0, 10) ?? ""}`)
          detailFallback++
          extracted++
        }
      }
      continue
    }

    extracted++
    console.log(`  ✓ "${ev.eventName}" | ${ev.eventDateStart ?? "?"} → ${ev.eventDateEnd ?? ""} | city=${ev.city ?? "n/a"} | cf=${ev.confidence}`)
  }
  console.log(`[llm] Extracted: ${extracted} | Skipped: ${skipped} | Detail-fallback: ${detailFallback}`)
}

// ─── Run single URL test ───────────────────────────────────────────────────

async function testSingleUrl(url: string, venueName = "Test Venue") {
  console.log(`\n${"=".repeat(60)}`)
  console.log(`TEST: ${url}`)
  console.log(`=${"=".repeat(60)}`)

  const { markdown, provider, cloudflare } = await fetchPage(url)
  console.log(`\n[result] Provider: ${provider} | Cloudflare: ${cloudflare ? "YES ⚠️" : "no"} | Chars: ${markdown.length}`)

  if (!markdown || markdown.length < MIN_CONTENT_CHARS) {
    console.log(`[result] ❌ Content too short (${markdown.length} < ${MIN_CONTENT_CHARS})`)
    return
  }

  console.log(`[result] Content preview (first 300 chars):`)
  console.log(markdown.slice(0, 300))
  console.log(`...`)

  const { blocks } = splitIntoBlocks(markdown, url)
  showBlocks(blocks)

  await showExtraction(blocks, venueName, url)

  // Detail-page scrape pass
  const allUrls = extractAllDetailUrls(markdown)
  if (allUrls.length > blocks.length * 2) {
    console.log(`\n[detail-pass] ${allUrls.length} detail URLs found — scraping...`)
    let ok = 0
    let fail = 0
    for (let i = 0; i < Math.min(allUrls.length, 5); i++) {
      const detail = await fetchDetailPageEvent(allUrls[i])
      if (detail?.name) {
        const dateStr = detail.start ? detail.start.toISOString().slice(0, 10) : "no date"
        console.log(`  ✓ "${detail.name}" | ${dateStr}`)
        ok++
      } else {
        console.log(`  ✗ ${allUrls[i].slice(0, 60)}...`)
        fail++
      }
    }
    if (allUrls.length > 5) console.log(`  ... and ${allUrls.length - 5} more`)
    console.log(`[detail-pass] ${ok} ok, ${fail} fail (showing first 5 of ${allUrls.length})`)
  }
}

// ─── Run full scraper simulation on one source ─────────────────────────────

async function testSource(sourceId: string) {
  const source = await prisma.venueDirectorySource.findUnique({
    where: { id: sourceId },
    include: {
      directory: { select: { baseUrl: true, type: true, name: true } },
      venue: { select: { id: true, name: true, city: true, state: true, parentId: true } },
    },
  })

  if (!source) {
    console.error(`[test] Source not found: ${sourceId}`)
    process.exit(1)
  }

  console.log(`\n${"=".repeat(60)}`)
  console.log(`SOURCE TEST`)
  console.log(`=${"=".repeat(60)}`)
  console.log(`Venue:    ${source.venue.name}`)
  console.log(`URL:      ${source.sourceUrl}`)
  console.log(`Strategy: ${source.strategy}`)
  console.log(`Health:   ${source.healthStatus}`)
  console.log(`Active:   ${source.isActive}`)

  await testSingleUrl(source.sourceUrl!, source.venue.name)
}

// ─── Show all sources ready for scraping ───────────────────────────────────

async function showDueSources() {
  const sources = await prisma.venueDirectorySource.findMany({
    where: {
      isActive: true,
      healthStatus: { in: ["valid", "unconfirmed"] },
      OR: [{ nextCheckAt: { lte: new Date() } }, { nextCheckAt: null }],
    },
    include: {
      directory: { select: { baseUrl: true, name: true } },
      venue: { select: { name: true, city: true, state: true } },
    },
    take: 20,
    orderBy: { updatedAt: "desc" },
  })

  console.log(`\n${sources.length} sources due for scraping:\n`)
  for (const s of sources) {
    console.log(`  [${s.id.slice(0, 8)}] ${s.venue.name}`)
    console.log(`           ${s.sourceUrl}`)
    console.log(`           health=${s.healthStatus} lastScraped=${s.lastScrapedAt?.toISOString().slice(0, 10) ?? "never"} nextCheck=${s.nextCheckAt?.toISOString().slice(0, 10) ?? "now"}`)
    console.log()
  }
  console.log(`Run with: npx tsx scripts/test-listing-scrape.ts --venue-id=<id>`)
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()

  if (args.help || args.h) {
    console.log(`
test-listing-scrape.ts — Test the venue listing scraper

Usage:
  npx tsx scripts/test-listing-scrape.ts [options]

Options:
  --help                  Show this help
  --dry                   Dry run (show what would happen, no DB writes)
  --url=<url>             Test a specific URL directly
  --venue-id=<id>         Test a specific VenueDirectorySource by ID
  --show-sources          List all sources due for scraping
  --date-from=<YYYY-MM-DD>
  --date-to=<YYYY-MM-DD>

Examples:
  npx tsx scripts/test-listing-scrape.ts --show-sources
  npx tsx scripts/test-listing-scrape.ts --venue-id=cls123xxxx
  npx tsx scripts/test-listing-scrape.ts --url=https://example.com/events
  npx tsx scripts/test-listing-scrape.ts --url=https://example.com/events --date-from=2025-07-01
`)
    await prisma.$disconnect()
    return
  }

  if (args["show-sources"]) {
    await showDueSources()
    await prisma.$disconnect()
    return
  }

  if (args.url) {
    await testSingleUrl(args.url as string)
    await prisma.$disconnect()
    return
  }

  if (args["venue-id"]) {
    await testSource(args["venue-id"] as string)
    await prisma.$disconnect()
    return
  }

  console.log(`[test] No --url, --venue-id, or --show-sources provided. Showing due sources...`)
  await showDueSources()
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
