// Ingest script for directories/source sites without dedicated scrapers.
// Uses the external SCRAPE_API_BASE_URL server to discover and extract events
// via LLM-powered analysis of their listing pages.
//
// Usage: npx tsx scripts/ingest-generic-llm.ts
// Env: SCRAPE_API_BASE_URL (default http://localhost:8008)

import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { scrapeUrl } from "../lib/scrapers/generic-llm"
import { isExcludedHostname } from "../lib/scrapers/dedicated-domains"


const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null
const sourceSiteIdOverride = process.env.SOURCE_SITE_ID ?? null

function normalizeEventName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}

async function main() {
  console.log(`[GenericLLM] Starting at ${new Date().toISOString()}`)
  console.log(`[GenericLLM] runId=${runId ?? "none"} dateFrom=${dateFrom?.toISOString()?.slice(0, 10) ?? "any"} dateTo=${dateTo?.toISOString()?.slice(0, 10) ?? "any"}`)
  console.log(`[GenericLLM] SCRAPE_API_BASE_URL=${process.env.SCRAPE_API_BASE_URL || "http://localhost:8008"}`)

  const baseUrl = process.env.SCRAPE_API_BASE_URL
  if (!baseUrl) {
    console.warn("[GenericLLM] SCRAPE_API_BASE_URL not set, using http://localhost:8008")
  }

  // Fetch active source sites to scrape
  const sourceSites = sourceSiteIdOverride
    ? await prisma.sourceSite.findMany({ where: { id: sourceSiteIdOverride, active: true } })
    : await prisma.sourceSite.findMany({
        where: {
          active: true,
          sourceMode: "automated",
          scrapeMode: { notIn: ["skip"] },
        },
      })

  // Filter out ones that have dedicated scrapers
  const toScrape = sourceSites.filter(site => {
    if (!site.url) return false
    try {
      return !isExcludedHostname(new URL(site.url).hostname)
    } catch {
      return false
    }
  })

  console.log(`[GenericLLM] ${sourceSites.length} active sites, ${toScrape.length} eligible for generic LLM scraping`)

  if (toScrape.length === 0) {
    console.log("[GenericLLM] No eligible sites to scrape")
    return { recordsFound: 0, recordsNew: 0 }
  }

  // Keepalive ping to prevent Neon P1017 connection drops during long scrapes
  await withRetry(() => prisma.$queryRaw`SELECT 1`)

  let totalFound = 0
  let totalNew = 0
  let errors = 0

  for (let i = 0; i < toScrape.length; i++) {
    const site = toScrape[i]

    console.log(`[GenericLLM] [${i + 1}/${toScrape.length}] Scraping ${site.name} (${site.url})`)

    try {
      const result = await scrapeUrl(site.url!, {
        prompt: site.notes ? `${LIST_PROMPT}\n\nSOURCE-SITE INSTRUCTIONS:\n${site.notes}\n` : undefined,
      })

      if (result.error) {
        console.warn(`[GenericLLM] ${site.name}: ${result.error}`)
        continue
      }

      console.log(`[GenericLLM] ${site.name}: ${result.events.length} events found`)

      for (const ev of result.events) {
        if (!ev.eventName) continue

        totalFound++

        let eventDate = null
        if (ev.eventDateStart) {
          const d = new Date(ev.eventDateStart)
          if (!isNaN(d.getTime())) eventDate = d
        }

        // Skip date filtered
        if (dateFrom && eventDate && eventDate < dateFrom) continue
        if (dateTo && eventDate && eventDate > dateTo) continue

        let locationId: string | null = null
        if (ev.city) {
          const loc = await withRetry(() => prisma.location.findFirst({ where: { name: ev.city, active: true, type: "CITY" } }))
          if (loc) locationId = loc.id
        }

        // Skip if no location matched (locationId is required)
        if (!locationId) {
          console.log(`[GenericLLM] Skip (no location match): "${ev.eventName}" city="${ev.city}"`)
          continue
        }

        // Deduplicate by eventName
        const existing = await withRetry(() => prisma.event.findFirst({
          where: {
            eventName: { equals: normalizeEventName(ev.eventName), mode: "insensitive" },
          },
        }))
        if (existing) {
          console.log(`[GenericLLM] Duplicate skip: "${ev.eventName}"`)
          continue
        }

        await withRetry(() => prisma.event.create({
          data: {
            locationId,
            eventName: ev.eventName,
            eventDateStart: eventDate,
            eventDateEnd: ev.eventDateEnd ? new Date(ev.eventDateEnd) : null,
            sourceUrl: ev.sourceUrl ?? site.url,
            sourceSiteId: site.id,
            runId: runId ?? undefined,
            status: "new",
            rawLocationText: ev.city ?? null,
            rawVenueText: ev.venue ?? null,
          },
        }))
        totalNew++
      }
    } catch (err) {
      errors++
      console.error(`[GenericLLM] Error scraping ${site.name}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`\n[GenericLLM] ═══════════════════════════════════════`)
  console.log(`[GenericLLM] SUMMARY`)
  console.log(`[GenericLLM]   Sites:      ${toScrape.length}`)
  console.log(`[GenericLLM]   Found:      ${totalFound}`)
  console.log(`[GenericLLM]   New saved:  ${totalNew}`)
  console.log(`[GenericLLM]   Errors:     ${errors}`)
  console.log(`[GenericLLM] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}
main()
  .catch((e) => {
    console.error("[GenericLLM] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

// Re-use the default LIST_PROMPT
const LIST_PROMPT = `Extract a list of events from this webpage.

For each event, return:
- eventName (string): The event/conference/meeting name
- eventDateStart (string or null): Start date in ISO format (YYYY-MM-DD) if found, else null
- eventDateEnd (string or null): End date in ISO format if it's a multi-day event, else null
- sourceUrl (string or null): The URL for a detail/register page if available
- venue (string or null): Venue name if found
- city (string or null): City where the event takes place
- confidence ("high"|"medium"|"low"): How certain you are

Only extract events that are clearly displayed as upcoming/listed/future events.
Return ONLY valid JSON: {"events": [...]}`;
