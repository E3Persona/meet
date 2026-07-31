import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { resolve } from "path"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const excelPath = resolve(process.cwd(), "public/Baltimore Hotels in Greater-LA.xlsx")

interface HotelRow {
  Name: string
  "Address 1": string
  City: string
  State: string
  "Zip Code": number | string
  Phone: string
  "Website URL": string
  "Add location": string | null
}

async function parseExcelFile(): Promise<HotelRow[]> {
  const { execSync } = require('child_process')
  const pythonScript = `
import openpyxl
import json

wb = openpyxl.load_workbook('${excelPath}')
ws = wb.active

hotels = []
for i, row in enumerate(ws.iter_rows(min_row=3, values_only=True), 3):
    if row[0] and str(row[0]).strip() != 'Name':
        hotels.append({
            'Name': row[0],
            'Address 1': row[1],
            'City': row[2],
            'State': row[3],
            'Zip Code': row[4],
            'Phone': row[5],
            'Website URL': row[6],
            'Add location': row[7]
        })

print(json.dumps(hotels))
`
  
  try {
    const output = execSync(`python3 -c "${pythonScript}"`, { encoding: 'utf8' })
    const hotels: HotelRow[] = JSON.parse(output)
    return hotels
  } catch (error) {
    console.error('Error parsing Excel:', error)
    throw error
  }
}

async function seedBaltimoreHotels() {
  console.log("\n── Seeding Baltimore hotels from Excel ──")
  
  const hotels = await parseExcelFile()
  console.log(`  Found ${hotels.length} hotel records`)

  // Find Baltimore location
  const baltimoreLocation = await prisma.location.findFirst({
    where: { name: "Baltimore", type: "CITY" },
  })

  if (!baltimoreLocation) {
    console.log("  ERROR: Baltimore city location not found. Please seed locations first.")
    return
  }

  let createdCount = 0
  let updatedCount = 0
  let skippedCount = 0

  for (const hotel of hotels) {
    const name = hotel.Name?.trim()
    if (!name || name === "Name") {
      skippedCount++
      continue
    }

    const address = hotel["Address 1"]?.trim()
    const city = hotel.City?.trim()
    const state = hotel.State?.trim()
    const zip = hotel["Zip Code"]?.toString()?.trim()
    const phone = hotel.Phone?.trim()
    const website = hotel["Website URL"]?.trim()

    // Try to find existing venue by name (case-insensitive)
    const existing = await prisma.location.findFirst({
      where: {
        type: "VENUE",
        name: { contains: name, mode: "insensitive" },
      },
    })

    if (existing) {
      // Update existing venue with additional details
      await prisma.location.update({
        where: { id: existing.id },
        data: {
          address: address || existing.address,
          city: city || existing.city,
          state: state || existing.state,
        },
      })
      updatedCount++
      console.log(`  updated: ${name}`)
    } else {
      // Create new venue
      await prisma.location.create({
        data: {
          type: "VENUE",
          name: name,
          address: address || null,
          city: city || "Baltimore",
          state: state || "MD",
          parentId: baltimoreLocation.id,
        },
      })
      createdCount++
      console.log(`  created: ${name} at ${address || "no address"}`)
    }
  }

  console.log(`  → ${createdCount} venues created, ${updatedCount} updated, ${skippedCount} skipped`)
}

async function main() {
  console.log("=== Seeding Baltimore Hotels ===")
  await seedBaltimoreHotels()
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
