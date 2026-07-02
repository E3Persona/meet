import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeICA, cityToIcaSlug } from "../lib/scrapers/ica"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null

const ICA_MONTHS = [
  "july", "august", "september", "october",
  "november", "december", "january", "february",
  "march", "april", "may", "june",
]

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "ica" },
  })
  return {
    maxMonths: cfg?.maxMonths ?? 6,
    maxPages: cfg?.maxPages ?? 3,
    maxLocations: cfg?.maxLocations ?? 0,
    active: cfg?.active ?? true,
  }
}

async function main() {
  console.log(`[ICA/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[ICA/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[ICA/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[ICA/Ingest] Config: maxMonths=${config.maxMonths}, maxPages=${config.maxPages}`)

  const [locations, icaSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "internationalconferencealerts.com" },
      select: { id: true },
    }),
  ])

  // Filter to only cities that ICA can target
  const icaLocations = locations.filter((loc) => {
    const slug = cityToIcaSlug(loc.city ?? "", loc.state ?? "")
    return slug !== null
  })

  if (icaLocations.length === 0) {
    console.log("[ICA/Ingest] No active locations with ICA slugs")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const runLocations = config.maxLocations > 0
    ? icaLocations.slice(0, config.maxLocations)
    : icaLocations
  console.log(`[ICA/Ingest] ${icaLocations.length} ICA-supported locations, running ${runLocations.length} (maxLocations=${config.maxLocations})`)

  const sourceSiteId = icaSite?.id ?? null
  const upcomingMonths = ICA_MONTHS.slice(0, config.maxMonths)

  let totalFound = 0
  let totalNew = 0

  for (const loc of runLocations) {
    const slug = cityToIcaSlug(loc.city ?? "", loc.state ?? "")
    if (!slug) continue

    console.log(`[ICA/Ingest] Scraping ${slug} → ${loc.name} (${upcomingMonths.length} months)`)
    try {
      const icaEvents = await scrapeICA({
        citySlugs: [slug],
        months: upcomingMonths,
        maxPagesPerSlug: config.maxPages,
        skipDetailPages: false,
      })

      console.log(`[ICA/Ingest] ${slug}: ${icaEvents.length} events from ${icaEvents.length > 0 ? "detail pages" : "listing"}`)

      for (const ev of icaEvents) {
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

        const existing = await prisma.event.findFirst({
          where: {
            eventName: { equals: ev.eventName, mode: "insensitive" },
            locationId: loc.id,
            eventDateStart: eventDateStart ?? undefined,
          },
        })
        if (existing) continue

        const contacts = ev.contacts ?? []
        const primaryContact = contacts[0]

        const event = await prisma.event.create({
          data: {
            locationId: loc.id,
            eventName: ev.eventName,
            eventDateStart,
            eventDateEnd,
            sourceUrl: ev.eventUrl,
            sourceSiteId,
            runId: runId ?? undefined,
            organizerName: primaryContact?.organizerName ?? null,
            organizerTitle: primaryContact?.organizerOrg ?? null,
            organizerEmail: primaryContact?.organizerEmail ?? null,
          },
        })
        totalNew++

        if (contacts.length > 0) {
          let saved = false
          for (const c of contacts) {
            if (!c.organizerName && !c.organizerEmail) continue
            await prisma.eventContact.create({
              data: {
                eventId: event.id,
                name: c.organizerName ?? "",
                title: c.organizerOrg,
                email: c.organizerEmail,
                phone: c.organizerPhone,
                isPrimary: !saved,
                sourceUrl: ev.eventUrl,
                confidence: "high",
              },
            })
            saved = true
          }
          if (saved) console.log(`[ICA/Ingest] Saved contact(s) for "${ev.eventName}"`)
        }
      }
    } catch (err) {
      console.error(`[ICA/Ingest] Error scraping ${slug}:`, err)
    }
  }

  console.log(`[ICA/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[ICA/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
