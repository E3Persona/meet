import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"
import { parse } from "csv-parse/sync"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const csvPath = resolve(process.cwd(), "public/philly list 2.csv")

interface PhillyEventRow {
  "Organization Name": string
  "Event Name": string
  "Total Estimated Attendance": string
  "Peak Rooms": string
  "Event Start Date": string
  "Event End Date": string
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split("/")
  if (parts.length !== 3) return null
  // Format: MM/DD/YYYY
  const month = parseInt(parts[0], 10)
  const day = parseInt(parts[1], 10)
  const year = parseInt(parts[2], 10)
  if (isNaN(month) || isNaN(day) || isNaN(year)) return null
  return new Date(year, month - 1, day)
}

function parseAttendance(attendance: string): number | null {
  if (!attendance) return null
  // Remove commas and parse
  const cleaned = attendance.replace(/,/g, "").trim()
  const parsed = parseInt(cleaned, 10)
  return isNaN(parsed) ? null : parsed
}

async function seedPhillyEvents() {
  console.log("\n── Seeding Philadelphia events ──")
  
  const csvContent = readFileSync(csvPath, "utf-8")
  const records: PhillyEventRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  })

  console.log(`  Found ${records.length} event records`)

  // Find Philadelphia location
  const phillyLocation = await prisma.location.findFirst({
    where: { name: "Philadelphia", type: "CITY" },
  })

  if (!phillyLocation) {
    console.log("  ERROR: Philadelphia city location not found. Please seed locations first.")
    return
  }

  let eventCount = 0
  let skippedCount = 0

  for (const row of records) {
    const startDate = parseDate(row["Event Start Date"])
    const endDate = parseDate(row["Event End Date"])
    const attendance = parseAttendance(row["Total Estimated Attendance"])

    if (!startDate) {
      console.log(`  skip: ${row["Event Name"]} - invalid start date`)
      skippedCount++
      continue
    }

    // Skip confidential entries
    if (row["Organization Name"] === "Confidential") {
      skippedCount++
      continue
    }

    // Check for existing event (dedupe by name + start date + location)
    const existing = await prisma.event.findFirst({
      where: {
        eventName: row["Event Name"],
        eventDateStart: startDate,
        locationId: phillyLocation.id,
      },
    })

    if (existing) {
      skippedCount++
      continue
    }

    // Create event
    const event = await prisma.event.create({
      data: {
        eventName: row["Event Name"],
        eventDateStart: startDate,
        eventDateEnd: endDate,
        expectedAttendees: attendance,
        locationId: phillyLocation.id,
        status: "new",
        dateAdded: new Date(),
      },
    })

    eventCount++
    console.log(`  event: ${row["Event Name"]} (${row["Event Start Date"]}) - ${attendance || "?"} attendees`)
  }

  console.log(`  → ${eventCount} events created, ${skippedCount} skipped`)
}

async function main() {
  console.log("=== Seeding Philadelphia Events ===")
  await seedPhillyEvents()
  console.log("\n=== Seed complete ===")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
