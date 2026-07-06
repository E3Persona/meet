import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeACA } from "../lib/scrapers/allconferencealert"
import { fetchPageMarkdown } from "../lib/contact-finder"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

// Map location city names to ACA city slugs
const CITY_TO_SLUG: Record<string, string> = {
  "washington dc": "washington",
  "new york": "newyork",
  "san francisco": "sanfrancisco",
  "los angeles": "losangeles",
  "las vegas": "lasvegas",
  "san diego": "sandiego",
  "san antonio": "sanantonio",
}

function cityToSlug(city: string): string {
  const lower = city.toLowerCase().trim()
  if (CITY_TO_SLUG[lower]) return CITY_TO_SLUG[lower]
  return lower.replace(/[^a-z0-9]+/g, "")
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

async function main() {
  console.log(`[ACA/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[ACA/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[ACA/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true },
      orderBy: { id: "asc" },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "allconferencealert.net" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[ACA/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  // Group locations by city slug to avoid scraping same city twice
  const cityGroups = new Map<string, typeof locations>()
  for (const loc of locations) {
    const city = loc.city?.toLowerCase().trim()
    if (!city) continue
    const slug = cityToSlug(city)
    if (!cityGroups.has(slug)) cityGroups.set(slug, [])
    cityGroups.get(slug)!.push(loc)
  }

  const slugList = [...cityGroups.keys()]
  console.log(`[ACA/Ingest] ${slugList.length} unique cities to scrape (from ${locations.length} locations)`)

  let totalFound = 0
  let totalNew = 0

  for (const slug of slugList) {
    const locs = cityGroups.get(slug)!
    const cityName = locs[0].city!
    console.log(`[ACA/Ingest] Scraping city: ${cityName} (slug: ${slug})`)

    try {
      // Scrape listing + detail pages (detail pages have contact info)
      const acaEvents = await scrapeACA({
        mode: "city",
        citySlug: slug,
        fetchDetails: true,
      })

      console.log(`[ACA/Ingest] ${cityName}: ${acaEvents.length} events from listing`)

      // Filter to new events and save
      for (const ev of acaEvents) {
        totalFound++

        let eventDate: Date | null = null
        if (ev.eventDate) {
          const d = new Date(ev.eventDate)
          if (!isNaN(d.getTime())) eventDate = d
        }

        if (dateFrom && eventDate && eventDate < dateFrom) continue
        if (dateTo && eventDate && eventDate > dateTo) continue

        // Check each location in this city
        for (const loc of locs) {
          const existing = await prisma.event.findFirst({
            where: {
              eventName: { equals: ev.eventName, mode: "insensitive" },
              locationId: loc.id,
              eventDateStart: eventDate ?? undefined,
            },
          })
          if (existing) continue

          // Fetch contact from detail page via Jina AI
          let contactPerson = ev.contact.contactPerson
          let organizedBy = ev.contact.organizedBy
          let inquiryEmail = ev.contact.inquiryEmail

          if (!contactPerson && !inquiryEmail && ev.eventUrl) {
            try {
              const md = await fetchPageMarkdown(ev.eventUrl)
              if (md) {
                // Simple extraction from markdown
                const cpMatch = md.match(/Contact Person[:\s]*\n?\s*(.+)/i)
                if (cpMatch) contactPerson = cpMatch[1].trim()
                // Try multiple email patterns
                const emMatch = md.match(/(?:Event Enquiries|Email|Enquir|Contact)[:\s]*\n?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
                if (emMatch) {
                  inquiryEmail = emMatch[1].trim()
                } else {
                  // Last resort: find any email address on the page
                  const anyEmail = md.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
                  if (anyEmail) inquiryEmail = anyEmail[0]
                }
                const obMatch = md.match(/Organized By[:\s]*\n?\s*(.+)/i)
                if (obMatch) organizedBy = obMatch[1].trim()
              }
            } catch {
              // Detail page failed — save without contact
            }
          }

          const event = await prisma.event.create({
            data: {
              locationId: loc.id,
              eventName: ev.eventName,
              eventDateStart: eventDate,
              sourceUrl: ev.eventUrl,
              sourceSiteId,
              runId: runId ?? undefined,
              expectedAttendees: null,
              organizerName: contactPerson ?? null,
              organizerTitle: organizedBy ?? null,
              organizerEmail: inquiryEmail ?? null,
            },
          })
          totalNew++

          const hasContact = contactPerson || organizedBy || inquiryEmail
          if (hasContact) {
            await prisma.eventContact.create({
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
            console.log(`[ACA/Ingest] Saved contact for "${ev.eventName}"`)
          }
        }
      }
    } catch (err) {
      console.error(`[ACA/Ingest] Error scraping ${cityName}:`, err)
    }
  }

  console.log(`[ACA/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[ACA/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
