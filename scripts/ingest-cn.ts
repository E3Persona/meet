import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeCN, cityToCnSlug } from "../lib/scrapers/conferencenext"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null

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
  if (runId) console.log(`[CN/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[CN/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }
  console.log(`[CN/Ingest] Config: maxPages=${config.maxPages}`)

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

  const cnLocations = locations.filter((loc) => {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    return slug !== null
  })

  if (cnLocations.length === 0) {
    console.log("[CN/Ingest] No active locations with CN slugs")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const runLocations = config.maxLocations > 0
    ? cnLocations.slice(0, config.maxLocations)
    : cnLocations
  console.log(`[CN/Ingest] ${cnLocations.length} CN-supported locations, running ${runLocations.length} (maxLocations=${config.maxLocations})`)

  const sourceSiteId = sourceSite?.id ?? null
  let totalFound = 0
  let totalNew = 0

  for (const loc of runLocations) {
    const slug = cityToCnSlug(loc.city ?? "", loc.state ?? "")
    if (!slug) continue

    console.log(`[CN/Ingest] Scraping ${slug} → ${loc.name}`)
    try {
      const events = await scrapeCN({
        citySlugs: [slug],
        maxPagesPerCity: config.maxPages,
        skipDetailPages: false,
      })

      console.log(`[CN/Ingest] ${slug}: ${events.length} events`)

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

        const existing = await prisma.event.findFirst({
          where: {
            eventName: { equals: ev.eventName, mode: "insensitive" },
            locationId: loc.id,
            eventDateStart: eventDateStart ?? undefined,
          },
        })
        if (existing) continue

        const contacts = ev.contacts ?? []
        const primaryContact = contacts.find((c) => c.organizerEmail) ?? contacts[0]

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
            organizerPhone: primaryContact?.organizerPhone ?? null,
          },
        })
        totalNew++

        // Save all contacts to EventContact
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
          if (saved) console.log(`[CN/Ingest] Saved contact(s) for "${ev.eventName}"`)
        }
      }
    } catch (err) {
      console.error(`[CN/Ingest] Error scraping ${slug}:`, err)
    }
  }

  console.log(`[CN/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[CN/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
