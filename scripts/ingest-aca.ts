import "dotenv/config"
import { prisma, withRetry } from "../lib/prisma"
import { scrapeACA } from "../lib/scrapers/allconferencealert"
import { fetchPageMarkdown } from "../lib/contact-finder"
import { buildVenueMap } from "../lib/venueResolution"
import { startIngestRun, finishIngestRun, type IngestRunContext } from "../lib/ingest-run"

const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true"

function debug(...args: unknown[]) {
  if (DEBUG) console.log("[ACA/Debug]", ...args)
}

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "aca" },
  })
  return {
    active: cfg?.active ?? true,
    maxLocations: cfg?.maxLocations ?? 0,
  }
}

function pickCityLocation(locs: { id: string; name: string | null }[]) {
  const catchAll = locs.find((l) => l.name?.toLowerCase().startsWith("other"))
  return catchAll ?? locs[0]
}

function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, " ")
}

async function main() {
  const ctx = await startIngestRun(process.env.TRIGGER as any || "manual")
  console.log(`[ACA/Ingest] Starting at ${new Date().toISOString()}`)
  console.log(`[ACA/Ingest] Config: dateFrom=${dateFrom?.toISOString()?.slice(0, 10) ?? "any"} dateTo=${dateTo?.toISOString()?.slice(0, 10) ?? "any"} DEBUG=${DEBUG}`)

  const config = await getConfig()
  console.log(`[ACA/Ingest] IngestConfig: active=${config.active} maxLocations=${config.maxLocations}`)
  if (!config.active) {
    console.log("[ACA/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, venues, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true, type: "CITY" },
      select: { id: true, name: true, city: true },
      orderBy: { id: "asc" },
    }),
    prisma.location.findMany({
      where: { active: true, type: "VENUE" },
      select: { id: true, name: true, city: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "allconferencealert.net" },
      select: { id: true },
    }),
  ])

  console.log(`[ACA/Ingest] Loaded ${locations.length} active locations, sourceSite=${sourceSite?.id ?? "NOT FOUND"}`)

  if (locations.length === 0) {
    console.log("[ACA/Ingest] No active locations — nothing to do")
    return { recordsFound: 0, recordsNew: 0 }
  }

  debug("Raw locations:", locations.map((l) => `${l.id} | ${l.name} | city=${l.city}`))

  const sourceSiteId = sourceSite?.id ?? null

  // Build venue name lookup for venue matching
  const venueMap = buildVenueMap(venues)

  const cityGroups = new Map<string, typeof locations>()
  const skippedNoCity: typeof locations = []
  for (const loc of locations) {
    const city = loc.city?.trim()
    if (!city) {
      skippedNoCity.push(loc)
      continue
    }
    const key = normalizeCity(city)
    if (!cityGroups.has(key)) cityGroups.set(key, [])
    cityGroups.get(key)!.push(loc)
  }

  if (skippedNoCity.length > 0) {
    console.log(`[ACA/Ingest] ${skippedNoCity.length} location(s) have no city — skipping: ${skippedNoCity.map((l) => l.name).join(", ")}`)
  }

  const targetCities = [...cityGroups.keys()]
  console.log(`[ACA/Ingest] ${targetCities.length} target cities (from ${locations.length} locations):`)
  for (const [city, locs] of cityGroups) {
    console.log(`  - "${city}" → ${locs.map((l) => l.name).join(", ")}`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedOutOfRegion = 0
  let skippedDuplicate = 0
  let skippedDateRange = 0
  let withContact = 0
  let withoutContact = 0

  try {
    await withRetry(() => prisma.$queryRaw`SELECT 1`)
    console.log(`[ACA/Ingest] Starting ACA scrape (fetchDetails=true, country-wide)...`)
    const scrapeStart = Date.now()

    const acaEvents = await scrapeACA({
      fetchDetails: true,
      targetCities,
    })

    const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)
    console.log(`[ACA/Ingest] Scrape complete in ${scrapeDuration}s — ${acaEvents.length} total events from usa.php`)

    if (acaEvents.length === 0) {
      console.warn("[ACA/Ingest] WARNING: 0 events scraped — ACA site may be down or markup changed")
    }

    // Show first few raw events for debugging
    if (acaEvents.length > 0) {
      debug("First 5 raw ACA events:")
      for (const ev of acaEvents.slice(0, 5)) {
        debug(`  "${ev.eventName}" | city="${ev.venueCity}" date=${ev.eventDate ?? "null"}`)
        debug(`    contactPerson="${ev.contact.contactPerson}" organizedBy="${ev.contact.organizedBy}" email="${ev.contact.inquiryEmail}"`)
        debug(`    url=${ev.eventUrl}`)
      }
    }

    for (const ev of acaEvents) {
      const cityKey = normalizeCity(ev.venueCity)
      const locs = cityGroups.get(cityKey)
      if (!locs) {
        skippedOutOfRegion++
        debug(`Skip (out of region): "${ev.eventName}" city="${ev.venueCity}"`)
        continue
      }

      totalFound++

      let eventDate: Date | null = null
      if (ev.eventDate) {
        const d = new Date(ev.eventDate)
        if (!isNaN(d.getTime())) eventDate = d
      }

      if (dateFrom && eventDate && eventDate < dateFrom) {
        skippedDateRange++
        debug(`Skip (before dateFrom): "${ev.eventName}" date=${eventDate.toISOString().slice(0, 10)}`)
        continue
      }
      if (dateTo && eventDate && eventDate > dateTo) {
        skippedDateRange++
        debug(`Skip (after dateTo): "${ev.eventName}" date=${eventDate.toISOString().slice(0, 10)}`)
        continue
      }

      const existing = await withRetry(() =>
        prisma.event.findFirst({
          where: {
            eventName: { equals: ev.eventName, mode: "insensitive" },
          },
        })
      )
      if (existing) {
        skippedDuplicate++
        debug(`Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
        const newDesc = ev.objective ?? null
        const existingMeta = (existing.metadata as Record<string, unknown>) ?? {}
        if (newDesc && !existingMeta.fullDescription) {
          await withRetry(() =>
            prisma.event.update({
              where: { id: existing.id },
              data: { metadata: { ...existingMeta, fullDescription: newDesc } },
            })
          )
        }
        continue
      }

      const loc = pickCityLocation(locs)

      // ACA doesn't provide venue names, so we only match at city level
      let matchType: import("../lib/generated/prisma/client").EventMatchType = "location_matched"

      let contactPerson = ev.contact.contactPerson
      let organizedBy = ev.contact.organizedBy
      let inquiryEmail = ev.contact.inquiryEmail

      debug(`Processing: "${ev.eventName}" | city="${ev.venueCity}" → location="${loc.name}" (${loc.id})`)
      debug(`  Raw contact from ACA: person="${contactPerson}" org="${organizedBy}" email="${inquiryEmail}"`)

      if (!contactPerson && !inquiryEmail && ev.eventUrl) {
        debug(`  No contact from ACA detail page — trying Jina fallback for ${ev.eventUrl}`)
        try {
          const md = await fetchPageMarkdown(ev.eventUrl)
          if (md) {
            debug(`  Jina returned ${md.length} chars`)
            const cpMatch = md.match(/Contact Person[:\s]*\n?\s*(.+)/i)
            if (cpMatch) contactPerson = cpMatch[1].trim()
            const emMatch = md.match(
              /(?:Event Enquiries|Email|Enquir|Contact)[:\s]*\n?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
            )
            if (emMatch) {
              inquiryEmail = emMatch[1].trim()
            } else {
              const anyEmail = md.match(
                /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
              )
              if (anyEmail) inquiryEmail = anyEmail[0]
            }
            const obMatch = md.match(/Organized By[:\s]*\n?\s*(.+)/i)
            if (obMatch) organizedBy = obMatch[1].trim()
            debug(`  Jina fallback result: person="${contactPerson}" org="${organizedBy}" email="${inquiryEmail}"`)
          } else {
            debug(`  Jina returned empty/null`)
          }
        } catch (err) {
          debug(`  Jina fallback failed: ${err instanceof Error ? err.message : err}`)
        }
      }

      let venueId: string | null = null
      const event = await withRetry(() =>
        prisma.event.create({
          data: {
            locationId: loc.id,
            venueId: venueId ?? undefined,
            matchType,
            eventName: ev.eventName,
            eventDateStart: eventDate,
            sourceUrl: ev.eventUrl,
            sourceSiteId,
            runId: ctx.runId ?? undefined,
            expectedAttendees: null,
            rawLocationText: ev.venueCity,
            rawVenueText: null,
            organizerName: contactPerson ?? null,
            organizerTitle: organizedBy ?? null,
            organizerEmail: inquiryEmail ?? null,
            metadata: ev.objective ? { fullDescription: ev.objective } : undefined,
          },
        })
      )
      totalNew++

      const hasContact = contactPerson || organizedBy || inquiryEmail
      if (hasContact) {
        withContact++
        await withRetry(() =>
          prisma.eventContact.create({
            data: {
              eventId: event.id,
              name: contactPerson ?? "",
              title: organizedBy,
              email: inquiryEmail,
              phone: null,
              isPrimary: true,
              sourceUrl: ev.eventUrl,
              confidence: "high",
            },
          })
        )
        console.log(
          `[ACA/Ingest] ✓ Saved "${ev.eventName}" (${ev.venueCity}) — name="${contactPerson}" org="${organizedBy}" email="${inquiryEmail}"`
        )
      } else {
        withoutContact++
        console.log(
          `[ACA/Ingest] ✗ No contact for "${ev.eventName}" (${ev.venueCity}, ${ev.eventUrl})`
        )
      }
    }
  } catch (err) {
    console.error(`[ACA/Ingest] Error during scrape/ingest:`, err)
  }

  console.log(`\n[ACA/Ingest] ═══════════════════════════════════════`)
  console.log(`[ACA/Ingest] SUMMARY`)
  console.log(`[ACA/Ingest]   Total scraped:    ${totalFound + skippedOutOfRegion}`)
  console.log(`[ACA/Ingest]   In-region:        ${totalFound}`)
  console.log(`[ACA/Ingest]   Out-of-region:    ${skippedOutOfRegion}`)
  console.log(`[ACA/Ingest]   Date filtered:    ${skippedDateRange}`)
  console.log(`[ACA/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[ACA/Ingest]   New saved:        ${totalNew}`)
  console.log(`[ACA/Ingest]     with contact:   ${withContact}`)
  console.log(`[ACA/Ingest]     without contact: ${withoutContact}`)
  console.log(`[ACA/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[ACA/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
