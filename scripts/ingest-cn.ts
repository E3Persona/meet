import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeCN, cityToCnSlug } from "../lib/scrapers/conferencenext"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null
const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true"

function debug(...args: unknown[]) {
  if (DEBUG) console.log("[CN/Debug]", ...args)
}

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "cn" },
  })
  return {
    maxPages: cfg?.maxPages ?? 3,
    maxLocations: cfg?.maxLocations ?? 0,
    active: cfg?.active ?? true,
  }
}

async function main() {
  console.log(`[CN/Ingest] Starting at ${new Date().toISOString()}`)
  console.log(`[CN/Ingest] Config: runId=${runId ?? "none"} dateFrom=${dateFrom?.toISOString()?.slice(0, 10) ?? "any"} dateTo=${dateTo?.toISOString()?.slice(0, 10) ?? "any"} DEBUG=${DEBUG}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[CN/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[CN/Ingest] Config: maxPages=${config.maxPages} maxLocations=${config.maxLocations}`)

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "conferencenext.com" },
      select: { id: true },
    }),
  ])

  const sourceSiteId = sourceSite?.id ?? null
  console.log(`[CN/Ingest] Loaded ${locations.length} active locations, sourceSite=${sourceSiteId ?? "NOT FOUND"}`)

  const cnLocations = locations.filter((loc) => {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    return slug !== null
  })

  const skippedLocations = locations.filter((loc) => {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    return slug === null
  })

  if (skippedLocations.length > 0) {
    debug(`${skippedLocations.length} locations have no CN slug:`, skippedLocations.map((l) => `${l.name} (${l.city}, ${l.state})`))
  }

  if (cnLocations.length === 0) {
    console.log("[CN/Ingest] No active locations with CN slugs")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const runLocations = config.maxLocations > 0
    ? cnLocations.slice(0, config.maxLocations)
    : cnLocations
  console.log(`[CN/Ingest] ${cnLocations.length} CN-supported locations, running ${runLocations.length}:`)
  for (const loc of runLocations) {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    console.log(`  - "${loc.name}" (${loc.city}, ${loc.state}) → slug="${slug}"`)
  }

  let totalFound = 0
  let totalNew = 0
  let skippedDuplicate = 0
  let skippedDateRange = 0
  let withContact = 0
  let withoutContact = 0

  for (const loc of runLocations) {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    if (!slug) continue

    console.log(`\n[CN/Ingest] Scraping ${slug} → ${loc.name}`)
    try {
      const scrapeStart = Date.now()
      const events = await scrapeCN({
        citySlugs: [slug],
        maxPagesPerCity: config.maxPages,
        skipDetailPages: false,
      })
      const scrapeDuration = ((Date.now() - scrapeStart) / 1000).toFixed(1)

      console.log(`[CN/Ingest] ${slug}: ${events.length} events scraped in ${scrapeDuration}s`)

      if (events.length > 0) {
        debug(`First 3 events from ${slug}:`)
        for (const ev of events.slice(0, 3)) {
          debug(`  "${ev.eventName}" date=${ev.eventDateStart ?? "null"} url=${ev.eventUrl}`)
          debug(`    contacts=${JSON.stringify(ev.contacts)}`)
        }
      }

      for (const ev of events) {
        totalFound++

        let eventDateStart: Date | null = null
        let eventDateEnd: Date | null = null
        if (ev.eventDateStart) {
          const d = new Date(ev.eventDateStart)
          if (!isNaN(d.getTime())) eventDateStart = d
        }
        if (ev.eventDateEnd) {
          const d = new Date(ev.eventDateEnd)
          if (!isNaN(d.getTime())) eventDateEnd = d
        }

        if (dateFrom && eventDateStart && eventDateStart < dateFrom) {
          skippedDateRange++
          debug(`Skip (before dateFrom): "${ev.eventName}" date=${eventDateStart.toISOString().slice(0, 10)}`)
          continue
        }
        if (dateTo && eventDateStart && eventDateStart > dateTo) {
          skippedDateRange++
          debug(`Skip (after dateTo): "${ev.eventName}" date=${eventDateStart.toISOString().slice(0, 10)}`)
          continue
        }

        const existing = await prisma.event.findFirst({
          where: {
            eventName: { equals: ev.eventName, mode: "insensitive" },
            locationId: loc.id,
            eventDateStart: eventDateStart ?? undefined,
          },
        })
        if (existing) {
          skippedDuplicate++
          debug(`Skip (duplicate): "${ev.eventName}" id=${existing.id}`)
          continue
        }

        const contacts = ev.contacts ?? []
        const primaryContact = contacts.find((c) => c.organizerEmail) ?? contacts[0]

        debug(`Processing: "${ev.eventName}" → location="${loc.name}" (${loc.id})`)
        debug(`  sourceUrl=${ev.eventUrl}`)
        debug(`  contact: name="${primaryContact?.organizerName ?? ""}" email="${primaryContact?.organizerEmail ?? ""}" phone="${primaryContact?.organizerPhone ?? ""}" org="${primaryContact?.organizerOrg ?? ""}"`)

        const event = await prisma.event.create({
          data: {
            locationId: loc.id,
            eventName: ev.eventName,
            eventDateStart,
            eventDateEnd,
            sourceUrl: ev.eventUrl,
            sourceSiteId,
            runId: runId ?? undefined,
            expectedAttendees: null,
            organizerName: primaryContact?.organizerName ?? null,
            organizerTitle: primaryContact?.organizerOrg ?? null,
            organizerEmail: primaryContact?.organizerEmail ?? null,
            organizerPhone: primaryContact?.organizerPhone ?? null,
          },
        })
        totalNew++
        debug(`  Saved event id=${event.id}`)

        // Save all contacts to EventContact
        let savedContact = false
        for (const c of contacts) {
          if (!c.organizerName && !c.organizerEmail) continue
          await prisma.eventContact.create({
            data: {
              eventId: event.id,
              name: c.organizerName ?? "",
              title: c.organizerOrg,
              email: c.organizerEmail,
              phone: c.organizerPhone,
              isPrimary: !savedContact,
              sourceUrl: ev.eventUrl,
              confidence: "high",
            },
          })
          savedContact = true
          debug(`  Saved contact: name="${c.organizerName}" email="${c.organizerEmail}" phone="${c.organizerPhone}"`)
        }

        if (savedContact) {
          withContact++
          console.log(`[CN/Ingest] ✓ Saved "${ev.eventName}" — name="${primaryContact?.organizerName ?? ""}" email="${primaryContact?.organizerEmail ?? ""}" phone="${primaryContact?.organizerPhone ?? ""}"`)
        } else {
          withoutContact++
          console.log(`[CN/Ingest] ✗ No contact for "${ev.eventName}" url=${ev.eventUrl}`)
        }
      }
    } catch (err) {
      console.error(`[CN/Ingest] Error scraping ${slug}:`, err)
    }
  }

  console.log(`\n[CN/Ingest] ═══════════════════════════════════════`)
  console.log(`[CN/Ingest] SUMMARY`)
  console.log(`[CN/Ingest]   Total scraped:    ${totalFound}`)
  console.log(`[CN/Ingest]   Date filtered:    ${skippedDateRange}`)
  console.log(`[CN/Ingest]   Duplicates:       ${skippedDuplicate}`)
  console.log(`[CN/Ingest]   New saved:        ${totalNew}`)
  console.log(`[CN/Ingest]     with contact:   ${withContact}`)
  console.log(`[CN/Ingest]     without contact: ${withoutContact}`)
  console.log(`[CN/Ingest] ═══════════════════════════════════════\n`)

  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[CN/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
