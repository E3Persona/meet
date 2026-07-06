import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { scrapeASAE } from "../lib/scrapers/asae"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })
const runId = process.env.RUN_ID ?? null
const dateFrom = process.env.DATE_FROM ? new Date(process.env.DATE_FROM) : null
const dateTo = process.env.DATE_TO ? new Date(process.env.DATE_TO) : null

const MONTH_NAMES: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
}

async function getConfig() {
  const cfg = await prisma.ingestConfig.findUnique({
    where: { scraper: "asae" },
  })
  return {
    active: cfg?.active ?? true,
  }
}

function parseEventDate(month: string, day: string): Date | null {
  const m = MONTH_NAMES[month.toLowerCase().trim()]
  if (m === undefined) return null
  const d = parseInt(day, 10)
  if (isNaN(d)) return null
  const now = new Date()
  let year = now.getFullYear()
  const date = new Date(year, m, d)
  if (date.getTime() < now.getTime() - 86400000 * 30) {
    year++
  }
  return new Date(year, m, d)
}

function extractCitiesAndStates(locationText: string | null): { city: string; state: string }[] {
  if (!locationText) return []
  const results: { city: string; state: string }[] = []
  const parts = locationText.split("/").map((s) => s.trim())
  for (const part of parts) {
    const m = part.match(/([A-Za-z\s.]+),\s*([A-Z]{2})\b/)
    if (m) results.push({ city: m[1].trim(), state: m[2] })
  }
  return results
}

function matchLocation(
  locations: { id: string; name: string; city: string | null; state: string | null }[],
  citiesStates: { city: string; state: string }[]
): { id: string } | null {
  for (const cs of citiesStates) {
    const c = cs.city.toLowerCase().trim()
    const s = cs.state.toLowerCase().trim()
    for (const loc of locations) {
      const lc = loc.city?.toLowerCase().trim()
      const ls = loc.state?.toLowerCase().trim()
      if (lc === c && ls === s) return loc
    }
  }
  for (const cs of citiesStates) {
    const c = cs.city.toLowerCase().trim()
    for (const loc of locations) {
      if (loc.name.toLowerCase().includes(c)) return loc
    }
  }
  return null
}

async function main() {
  console.log(`[ASAE/Ingest] Starting at ${new Date().toISOString()}`)
  if (runId) console.log(`[ASAE/Ingest] Run ID: ${runId}`)

  const config = await getConfig()
  if (!config.active) {
    console.log("[ASAE/Ingest] Scraping disabled via IngestConfig")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const [locations, sourceSite] = await Promise.all([
    prisma.location.findMany({
      where: { active: true },
      select: { id: true, name: true, city: true, state: true },
      orderBy: { id: "asc" },
    }),
    prisma.sourceSite.findFirst({
      where: { name: "asaecenter.org" },
      select: { id: true },
    }),
  ])

  if (locations.length === 0) {
    console.log("[ASAE/Ingest] No active locations")
    return { recordsFound: 0, recordsNew: 0 }
  }

  const sourceSiteId = sourceSite?.id ?? null

  const allEvents = await scrapeASAE({ skipContacts: false, maxContactLookups: 50 })
  console.log(`[ASAE/Ingest] ${allEvents.length} events scraped`)

  let totalFound = 0
  let totalNew = 0

  for (const ev of allEvents) {
    totalFound++

    const citiesStates = extractCitiesAndStates(ev.locationText)
    if (citiesStates.length === 0) continue

    const loc = matchLocation(locations, citiesStates)
    if (!loc) continue

    const existing = await prisma.event.findFirst({
      where: {
        eventName: { equals: ev.eventName, mode: "insensitive" },
        locationId: loc.id,
      },
    })
    if (existing) continue

    const eventDateStart = parseEventDate(ev.eventMonth, ev.eventDay)

    if (dateFrom && eventDateStart && eventDateStart < dateFrom) continue
    if (dateTo && eventDateStart && eventDateStart > dateTo) continue
    const contact = ev.contact ?? null
    const hasContact = contact && (contact.organizerEmail || contact.organizerPhone)

    const event = await prisma.event.create({
      data: {
        locationId: loc.id,
        eventName: ev.eventName,
        eventDateStart: eventDateStart ?? undefined,
        sourceUrl: ev.detailUrl,
        sourceSiteId,
        runId: runId ?? undefined,
        expectedAttendees: null,
        organizerEmail: contact?.organizerEmail ?? null,
        organizerPhone: contact?.organizerPhone ?? null,
      },
    })
    totalNew++

    if (hasContact) {
      await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: "",
          email: contact!.organizerEmail,
          phone: contact!.organizerPhone,
          isPrimary: true,
          sourceUrl: ev.detailUrl,
          confidence: "medium",
        },
      })
      console.log(`[ASAE/Ingest] Saved contact for "${ev.eventName}"`)
    }
  }

  console.log(`[ASAE/Ingest] Complete: ${totalNew} new from ${totalFound}`)
  return { recordsFound: totalFound, recordsNew: totalNew }
}

main()
  .catch((e) => {
    console.error("[ASAE/Ingest] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
