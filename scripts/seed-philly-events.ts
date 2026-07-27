import "dotenv/config"
import * as fs from "fs"
import * as path from "path"
import { prisma } from "../lib/prisma"

function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue }
    current += ch
  }
  result.push(current.trim())
  return result
}

function parseAttendance(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "")
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? null : n
}

async function main() {
  const csvPath = path.resolve("public/philly list 2.csv")
  const content = fs.readFileSync(csvPath, "utf-8").trim()
  const lines = content.split("\n").filter(Boolean)

  // Skip header row
  const dataLines = lines.slice(1)
  console.log(`Found ${dataLines.length} rows`)

  // ── Find/create Philadelphia location ──
  let phillyLoc = await prisma.location.findFirst({
    where: { name: { equals: "Philadelphia", mode: "insensitive" }, type: "CITY" },
  })
  if (!phillyLoc) {
    phillyLoc = await prisma.location.create({
      data: { name: "Philadelphia", type: "CITY", city: "Philadelphia", state: "PA", active: true },
    })
    console.log(`Created location: Philadelphia (${phillyLoc.id})`)
  }

  // ── Also cache venue locations ──
  const allLocations = await prisma.location.findMany({ where: { active: true } })
  const locByName = new Map<string, (typeof allLocations)[0]>()
  for (const l of allLocations) {
    const key = l.name.toLowerCase().replace(/[^a-z0-9]/g, "")
    locByName.set(key, l)
  }

  function findOrCreateVenue(name: string) {
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "")
    if (locByName.has(key)) return locByName.get(key)!
    return null
  }

  let created = 0
  let skipped = 0
  let errors = 0

  for (const line of dataLines) {
    const cols = parseCSVLine(line)
    if (cols.length < 6) { skipped++; continue }

    const orgName = cols[0]
    const eventName = cols[1]
    const attendanceStr = cols[2]
    const peakRooms = cols[3]
    const dateStartStr = cols[4]
    const dateEndStr = cols[5]

    if (!eventName) { skipped++; continue }

    const eventDateStart = dateStartStr ? new Date(dateStartStr) : null
    const eventDateEnd = dateEndStr ? new Date(dateEndStr) : null

    if (eventDateStart && isNaN(eventDateStart.getTime())) { skipped++; continue }

    const location = findOrCreateVenue("Philadelphia") ?? phillyLoc

    // Check duplicate
    const exists = await prisma.event.findFirst({
      where: {
        eventName: { equals: eventName, mode: "insensitive" },
        locationId: location.id,
        eventDateStart: eventDateStart ?? undefined,
      },
    })
    if (exists) { skipped++; continue }

    try {
      await prisma.event.create({
        data: {
          locationId: location.id,
          eventName,
          eventDateStart,
          eventDateEnd,
          expectedAttendees: parseAttendance(attendanceStr),
          organizerName: orgName || null,
          status: "new",
        },
      })
      created++
      if (created % 10 === 0) console.log(`  ... ${created} created`)
    } catch (err) {
      console.error(`[ERR] "${eventName}":`, err instanceof Error ? err.message : err)
      errors++
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${errors} errors`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
