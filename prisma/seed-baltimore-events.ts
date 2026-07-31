import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"
import { parse } from "csv-parse/sync"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const csvPath = resolve(process.cwd(), "public/Baltimore Convention-Calendar-April-2026---April-2029-as-of-4.6.2026_EAF1B743-D412-F70B-9BB2BBE8D5D14DFC.xlsx - Convention Calendar, 2026-2029.csv")

interface BaltimoreEventRow {
  "Meeting Start Date": string
  "Meeting End Date": string
  "Account Name": string
  "Meeting Name": string
  "Headquarter Hotel": string
  "Event Facility": string
  "Attendance": string
  "Peak Rooms": string
  "Meeting Contact": string
  "Meeting Contact's Email": string
  "Meeting Contact's Address": string
  "Meeting Contact's Address 2": string
  "Meeting Contact's City": string
  "Meeting Contact's State": string
  "Meeting Contact's Zip Code": string
  "Meeting Contact's Phone Number": string
  "Meeting Contact's Fax Number": string
  "Account Website": string
}

function parseDate(dateStr: string): Date | null {
  if (!dateStr) return null
  const parts = dateStr.split("/")
  if (parts.length !== 3) return null
  // Format: M/D/YYYY
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

async function seedBaltimoreEvents() {
  console.log("\n── Seeding Baltimore Convention Calendar events ──")
  
  const csvContent = readFileSync(csvPath, "utf-8")
  const records: BaltimoreEventRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
  })

  console.log(`  Found ${records.length} event records`)

  // Find Baltimore location
  const baltimoreLocation = await prisma.location.findFirst({
    where: { name: "Baltimore", type: "CITY" },
  })

  if (!baltimoreLocation) {
    console.log("  ERROR: Baltimore city location not found. Please seed locations first.")
    return
  }

  let eventCount = 0
  let contactCount = 0
  let skippedCount = 0

  for (const row of records) {
    const startDate = parseDate(row["Meeting Start Date"])
    const endDate = parseDate(row["Meeting End Date"])
    const attendance = parseAttendance(row["Attendance"])

    if (!startDate) {
      console.log(`  skip: ${row["Meeting Name"]} - invalid start date`)
      skippedCount++
      continue
    }

    // Check for existing event (dedupe by name + start date + location)
    const existing = await prisma.event.findFirst({
      where: {
        eventName: row["Meeting Name"],
        eventDateStart: startDate,
        locationId: baltimoreLocation.id,
      },
    })

    if (existing) {
      skippedCount++
      continue
    }

    // Determine venue
    let venueId: string | null = null
    let rawVenueText: string | null = null

    const hotelName = row["Headquarter Hotel"]?.trim()
    const facilityName = row["Event Facility"]?.trim()

    if (hotelName && hotelName !== "TBD Hotel") {
      // Try to find matching venue
      const venue = await prisma.location.findFirst({
        where: {
          type: "VENUE",
          name: { contains: hotelName, mode: "insensitive" },
        },
      })
      if (venue) {
        venueId = venue.id
      } else {
        rawVenueText = hotelName
      }
    } else if (facilityName && facilityName !== "Baltimore Convention") {
      rawVenueText = facilityName
    }

    // Create event
    const event = await prisma.event.create({
      data: {
        eventName: row["Meeting Name"],
        eventDateStart: startDate,
        eventDateEnd: endDate,
        expectedAttendees: attendance,
        sourceUrl: row["Account Website"] || null,
        locationId: baltimoreLocation.id,
        venueId,
        rawVenueText,
        status: "new",
        dateAdded: new Date(),
      },
    })

    eventCount++
    console.log(`  event: ${row["Meeting Name"]} (${row["Meeting Start Date"]})`)

    // Create contact if contact info exists
    const contactName = row["Meeting Contact"]?.trim()
    const contactEmail = row["Meeting Contact's Email"]?.trim()
    const contactPhone = row["Meeting Contact's Phone Number"]?.trim()

    if (contactName || contactEmail || contactPhone) {
      const contact = await prisma.eventContact.create({
        data: {
          eventId: event.id,
          name: contactName || "Unknown",
          title: null, // Not provided in CSV
          email: contactEmail || null,
          phone: contactPhone || null,
          isPrimary: true,
          sourceUrl: row["Account Website"] || null,
          confidence: "high", // Direct from official calendar
        },
      })
      contactCount++
      console.log(`    contact: ${contactName || "Unknown"} (${contactEmail || contactPhone || ""})`)
    }
  }

  console.log(`  → ${eventCount} events created, ${contactCount} contacts added, ${skippedCount} skipped`)
}

async function main() {
  console.log("=== Seeding Baltimore Convention Calendar ===")
  await seedBaltimoreEvents()
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
