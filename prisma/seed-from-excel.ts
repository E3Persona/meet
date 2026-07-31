import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"
import openpyxl from 'openpyxl'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const excelPath = resolve(process.cwd(), "public/Event Venue list.xlsx")

interface VenueRow {
  regionCity: string
  state: string
  shortName: string | null
  fullName: string | null
  address: string | null
}

async function parseExcelFile(): Promise<Map<string, VenueRow[]>> {
  // Group venues by city
  const venuesByCity = new Map<string, VenueRow[]>()
  
  // Using Python to parse Excel since openpyxl is Python
  const { execSync } = require('child_process')
  const pythonScript = `
import openpyxl
import json

wb = openpyxl.load_workbook('${excelPath}')
ws = wb['ALL VENUES — Master List']

venues = []
current_city = None
current_state = None

for i, row in enumerate(ws.iter_rows(min_row=3, values_only=True), 3):
    if row[1] and str(row[1]).strip().endswith('—'):
        # This is a city header row
        parts = str(row[1]).strip().split('—')
        current_city = parts[0].strip()
        current_state = None
        continue
    
    if row[1] and not str(row[1]).strip().startswith('—'):
        # This is a venue row
        region_city = row[1]
        state = row[2]
        short_name = row[3]
        full_name = row[4]
        address = row[5]
        
        if region_city:
            current_city = region_city
        if state:
            current_state = state
        
        if current_city and (full_name or short_name):
            venues.append({
                'regionCity': current_city,
                'state': current_state,
                'shortName': short_name,
                'fullName': full_name,
                'address': address
            })

print(json.dumps(venues))
`
  
  try {
    const output = execSync(`python3 -c "${pythonScript}"`, { encoding: 'utf8' })
    const venues: VenueRow[] = JSON.parse(output)
    
    // Group by city
    for (const venue of venues) {
      const cityKey = venue.regionCity
      if (!venuesByCity.has(cityKey)) {
        venuesByCity.set(cityKey, [])
      }
      venuesByCity.get(cityKey)!.push(venue)
    }
    
    return venuesByCity
  } catch (error) {
    console.error('Error parsing Excel:', error)
    throw error
  }
}

async function seedStates() {
  console.log("\n── Seeding states ──")
  
  const states = ['PA', 'MD', 'DC', 'NJ', 'DE']
  const stateNames: Record<string, string> = {
    'PA': 'Pennsylvania',
    'MD': 'Maryland',
    'DC': 'District of Columbia',
    'NJ': 'New Jersey',
    'DE': 'Delaware'
  }
  
  let count = 0
  for (const stateCode of states) {
    const existing = await prisma.location.findFirst({
      where: { name: stateNames[stateCode], type: 'STATE' }
    })
    
    if (existing) {
      console.log(`  skip state: ${stateNames[stateCode]} (already exists)`)
      continue
    }
    
    await prisma.location.create({
      data: {
        type: 'STATE',
        name: stateNames[stateCode],
        state: stateCode,
      }
    })
    count++
    console.log(`  state: ${stateNames[stateCode]} (${stateCode})`)
  }
  
  console.log(`  → ${count} states created`)
}

async function seedCities(venuesByCity: Map<string, VenueRow[]>) {
  console.log("\n── Seeding cities ──")
  
  let cityCount = 0
  
  for (const [cityName, venues] of venuesByCity) {
    const stateCode = venues[0]?.state
    if (!stateCode) {
      console.log(`  skip city: ${cityName} (no state)`)
      continue
    }
    
    // Find the state
    const stateNames: Record<string, string> = {
      'PA': 'Pennsylvania',
      'MD': 'Maryland',
      'DC': 'District of Columbia',
      'NJ': 'New Jersey',
      'DE': 'Delaware'
    }
    
    const state = await prisma.location.findFirst({
      where: { name: stateNames[stateCode], type: 'STATE' }
    })
    
    if (!state) {
      console.log(`  skip city: ${cityName} (state ${stateCode} not found)`)
      continue
    }
    
    const existing = await prisma.location.findFirst({
      where: { name: cityName, type: 'CITY' }
    })
    
    if (existing) {
      console.log(`  skip city: ${cityName} (already exists)`)
      continue
    }
    
    const city = await prisma.location.create({
      data: {
        type: 'CITY',
        name: cityName,
        city: cityName,
        state: stateCode,
        parentId: state.id,
      }
    })
    cityCount++
    console.log(`  city: ${cityName}, ${stateCode} → ${city.id}`)
  }
  
  console.log(`  → ${cityCount} cities created`)
}

async function seedVenues(venuesByCity: Map<string, VenueRow[]>) {
  console.log("\n── Seeding venues ──")
  
  let venueCount = 0
  
  for (const [cityName, venues] of venuesByCity) {
    // Find the city
    const city = await prisma.location.findFirst({
      where: { name: cityName, type: 'CITY' }
    })
    
    if (!city) {
      console.log(`  skip venues for: ${cityName} (city not found)`)
      continue
    }
    
    for (const venue of venues) {
      const venueName = venue.fullName || venue.shortName
      if (!venueName) {
        console.log(`    skip venue with no name`)
        continue
      }
      
      const existing = await prisma.location.findFirst({
        where: { name: venueName, type: 'VENUE' }
      })
      
      if (existing) {
        console.log(`    skip venue: ${venueName} (already exists)`)
        continue
      }
      
      await prisma.location.create({
        data: {
          type: 'VENUE',
          name: venueName,
          shortName: venue.shortName,
          address: venue.address,
          city: cityName,
          state: venue.state,
          parentId: city.id,
        }
      })
      venueCount++
      console.log(`    venue: ${venueName}`)
    }
  }
  
  console.log(`  → ${venueCount} venues created`)
}

async function main() {
  console.log("=== Seeding locations from Excel ===")
  
  const venuesByCity = await parseExcelFile()
  console.log(`Found ${venuesByCity.size} cities in Excel`)
  
  await seedStates()
  await seedCities(venuesByCity)
  await seedVenues(venuesByCity)
  
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
