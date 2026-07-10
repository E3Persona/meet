import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import XLSX from "xlsx"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

function serialToDate(serial: number): Date {
  const epoch = new Date(1899, 11, 30)
  return new Date(epoch.getTime() + serial * 86400000)
}

function parsePhone(raw: unknown): string | null {
  if (!raw) return null
  const s = String(raw).trim().replace(/^0+$/, "")
  if (!s || s === "null") return null
  return s
}

async function main() {
  const wb = XLSX.readFile("public/BalimoreEvents.xlsx")
  const ws = wb.Sheets["Convention Calendar, 2026-2029"]
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(ws)

  console.log(`Found ${rows.length} rows`)

  // ── Cache locations by name ──
  const allLocations = await prisma.location.findMany({ where: { active: true } })
  const locByName = new Map<string, (typeof allLocations)[0]>()
  for (const l of allLocations) {
    const key = l.name.toLowerCase().replace(/[^a-z0-9]/g, "")
    locByName.set(key, l)
  }

  function findLocation(hotel: string | null, facility: string | null) {
    const candidates = [hotel, facility, "Baltimore"].filter(Boolean)
    for (const name of candidates) {
      const key = name!.toLowerCase().replace(/[^a-z0-9]/g, "")
      if (locByName.has(key)) return locByName.get(key)!
    }
    for (const l of allLocations) {
      if (l.city?.toLowerCase() === "baltimore" || l.state === "MD") return l
    }
    return null
  }

  let created = 0
  let skipped = 0
  let errors = 0

  for (const row of rows) {
    const eventName = String(row["Meeting Name"] ?? "").trim()
    if (!eventName) { skipped++; continue }

    const startSerial = row["Meeting Start Date"]
    const endSerial = row["Meeting End Date"]
    const eventDateStart = typeof startSerial === "number" ? serialToDate(startSerial) : null
    const eventDateEnd = typeof endSerial === "number" ? serialToDate(endSerial) : null
    const hotel = row["Headquarter Hotel"] ? String(row["Headquarter Hotel"]).trim() : null
    const facility = row["Event Facility"] ? String(row["Event Facility"]).trim() : null
    const sourceUrl = row["Account Website"] ? String(row["Account Website"]).trim() : null
    const organizerName = row["Meeting Contact"] ? String(row["Meeting Contact"]).trim() : null
    const organizerEmail = row["Meeting Contact's Email"] ? String(row["Meeting Contact's Email"]).trim() : null
    const organizerPhone = parsePhone(row["Meeting Contact's Phone Number"])
    const accountName = row["Account Name"] ? String(row["Account Name"]).trim() : null

    const location = findLocation(hotel, facility)
    if (!location) {
      console.warn(`[WARN] No location found for "${eventName}" (hotel=${hotel}, facility=${facility}) — skipping`)
      skipped++
      continue
    }

    const exists = await prisma.event.findFirst({
      where: {
        eventName: { equals: eventName, mode: "insensitive" },
        locationId: location.id,
        eventDateStart: eventDateStart ?? undefined,
      },
    })
    if (exists) {
      skipped++
      continue
    }

    try {
      await prisma.event.create({
        data: {
          locationId: location.id,
          eventName,
          eventDateStart,
          eventDateEnd,
          sourceUrl,
          organizerName,
          organizerEmail,
          organizerPhone,
          status: "new",
        },
      })
      created++
      if (created % 20 === 0) console.log(`  ... ${created} created`)
    } catch (err) {
      console.error(`[ERR] Failed "${eventName}":`, err instanceof Error ? err.message : err)
      errors++
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${errors} errors`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
