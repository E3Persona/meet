import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { readFileSync } from "fs"
import { resolve } from "path"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

interface VenueSeed {
  shortName: string | null
  fullName: string
  address: string
}

interface CitySeed {
  cityName: string
  state: string
  regionLabel: string
  district: string | null
  venues: VenueSeed[]
}

interface TemplateSeed {
  template: string
  example: string
  scope: "CITY" | "VENUE" | "GLOBAL"
}

interface DataSourceSeed {
  name: string
  likelyMode: "automated" | "manual"
}

const seedDir = resolve(process.cwd(), "prisma")

const locationsSeed: CitySeed[] = JSON.parse(
  readFileSync(resolve(seedDir, "locations_seed.json"), "utf-8")
)

const phrasesSeed: { templates: TemplateSeed[]; literalKeywords: string[] } = JSON.parse(
  readFileSync(resolve(seedDir, "search_phrases_seed.json"), "utf-8")
)

const dataSourcesSeed: DataSourceSeed[] = JSON.parse(
  readFileSync(resolve(seedDir, "data_sources_seed.json"), "utf-8")
)

async function seedLocations() {
  console.log("\n── Seeding locations (states → districts → cities → venues) ──")
  let stateCount = 0
  let districtCount = 0
  let cityCount = 0
  let venueCount = 0

  // First, ensure all states exist
  const stateNames: Record<string, string> = {
    'PA': 'Pennsylvania',
    'MD': 'Maryland',
    'DC': 'District of Columbia',
    'NJ': 'New Jersey',
    'DE': 'Delaware'
  }

  const uniqueStates = new Set(locationsSeed.map(c => c.state))
  for (const stateCode of uniqueStates) {
    if (!stateCode) continue
    
    const stateName = stateNames[stateCode]
    if (!stateName) {
      console.log(`  skip unknown state code: ${stateCode}`)
      continue
    }

    const existing = await prisma.location.findFirst({
      where: { name: stateName, type: "STATE" },
    })
    if (existing) {
      console.log(`  skip state: ${stateName} (already exists)`)
      continue
    }

    await prisma.location.create({
      data: {
        type: "STATE",
        name: stateName,
        state: stateCode,
      },
    })
    stateCount++
    console.log(`  state: ${stateName} (${stateCode})`)
  }

  // Collect unique districts
  const districtMap = new Map<string, { name: string; stateCode: string }>()
  for (const city of locationsSeed) {
    if (city.district && city.state) {
      const key = `${city.state}:${city.district}`
      if (!districtMap.has(key)) {
        districtMap.set(key, { name: city.district, stateCode: city.state })
      }
    }
  }

  // Seed districts
  for (const [key, district] of districtMap) {
    const stateName = stateNames[district.stateCode]
    if (!stateName) {
      console.log(`  skip district: ${district.name} (unknown state: ${district.stateCode})`)
      continue
    }

    const state = await prisma.location.findFirst({
      where: { name: stateName, type: "STATE" },
    })
    if (!state) {
      console.log(`  skip district: ${district.name} (state not found: ${stateName})`)
      continue
    }

    const existing = await prisma.location.findFirst({
      where: { name: district.name, type: "DISTRICT" },
    })
    if (existing) {
      console.log(`  skip district: ${district.name} (already exists)`)
      continue
    }

    await prisma.location.create({
      data: {
        type: "DISTRICT",
        name: district.name,
        state: district.stateCode,
        parentId: state.id,
      },
    })
    districtCount++
    console.log(`  district: ${district.name} → ${stateName}`)
  }

  // Then seed cities with parent district or state
  for (const city of locationsSeed) {
    const stateName = stateNames[city.state]
    if (!stateName) {
      console.log(`  skip city: ${city.cityName} (unknown state: ${city.state})`)
      continue
    }

    let parentId: string
    let parentLabel: string

    if (city.district) {
      const district = await prisma.location.findFirst({
        where: { name: city.district, type: "DISTRICT" },
      })
      if (!district) {
        console.log(`  skip city: ${city.cityName} (district not found: ${city.district})`)
        continue
      }
      parentId = district.id
      parentLabel = city.district
    } else {
      const state = await prisma.location.findFirst({
        where: { name: stateName, type: "STATE" },
      })
      if (!state) {
        console.log(`  skip city: ${city.cityName} (state not found: ${stateName})`)
        continue
      }
      parentId = state.id
      parentLabel = stateName
    }

    const existing = await prisma.location.findFirst({
      where: { name: city.cityName, type: "CITY" },
    })
    if (existing) {
      console.log(`  skip city: ${city.cityName} (already exists)`)
      continue
    }

    const cityRecord = await prisma.location.create({
      data: {
        type: "CITY",
        name: city.cityName,
        city: city.cityName,
        state: city.state,
        parentId: parentId,
      },
    })
    cityCount++
    console.log(`  city: ${city.cityName}, ${city.state} → ${parentLabel} → ${cityRecord.id}`)

    for (const venue of city.venues) {
      const venueName = venue.fullName ?? venue.shortName
      if (!venueName) {
        console.log(`    skip venue with no name (shortName: ${venue.shortName})`)
        continue
      }

      const existingVenue = await prisma.location.findFirst({
        where: { name: venueName, type: "VENUE" },
      })
      if (existingVenue) {
        console.log(`    skip venue: ${venueName} (already exists)`)
        continue
      }

      await prisma.location.create({
        data: {
          type: "VENUE",
          name: venueName,
          shortName: venue.shortName,
          city: city.cityName,
          state: city.state,
          address: venue.address,
          parentId: cityRecord.id,
        },
      })
      venueCount++
    }
  }

  console.log(`  → ${stateCount} states, ${districtCount} districts, ${cityCount} cities, ${venueCount} venues created`)
}

async function seedSearchTemplates() {
  console.log("\n── Seeding search templates with scope ──")
  const existing = await prisma.searchTemplate.count()
  if (existing > 0) {
    console.log(`  skip: ${existing} templates already exist`)
    return
  }

  const seen = new Set<string>()
  const unique = phrasesSeed.templates.filter((t) => {
    const key = t.template.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  await prisma.searchTemplate.createMany({
    data: unique.map((t) => ({
      template: t.template.trim(),
      scope: t.scope as "CITY" | "VENUE" | "GLOBAL",
    })),
  })

  console.log(`  → ${unique.length} templates created`)
}

async function seedGlobalSearchTerms() {
  console.log("\n── Seeding global search terms ──")
  const existing = await prisma.searchTerm.count()
  if (existing > 0) {
    console.log(`  skip: ${existing} search terms already exist`)
    return
  }

  const keywords = phrasesSeed.literalKeywords
  let count = 0

  const bcc = await prisma.location.findFirst({
    where: { name: "Baltimore Convention Center" },
  })

  for (const kw of keywords) {
    if (!kw.trim()) continue

    if (kw.includes("Baltimore Convention Center") && bcc) {
      await prisma.searchTerm.create({
        data: { keyword: kw.trim(), locationId: bcc.id },
      })
      console.log(`  pinned to BCC: "${kw.trim()}"`)
    } else {
      await prisma.searchTerm.create({
        data: { keyword: kw.trim(), locationId: null },
      })
    }
    count++
  }

  console.log(`  → ${count} search terms created (${keywords.length - count} skipped)`)
}

async function seedSourceSites() {
  console.log("\n── Seeding source sites with sourceMode ──")
  const existing = await prisma.sourceSite.count()
  if (existing > 0) {
    console.log(`  skip: ${existing} source sites already exist`)
    return
  }

  const seen = new Set<string>()
  const unique = dataSourcesSeed.filter((s) => {
    const key = s.name.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const manualCount = unique.filter((s) => s.likelyMode === "manual").length
  const autoCount = unique.filter((s) => s.likelyMode === "automated").length

  await prisma.sourceSite.createMany({
    data: unique.map((s) => ({
      name: s.name.trim(),
      sourceMode: s.likelyMode === "manual" ? "manual" : "automated",
      scrapeMode: s.likelyMode === "manual" ? "skip" : "auto",
      active: true,
      notes: s.likelyMode === "manual"
        ? "Manual source — no automated scraping possible. Check periodically for new events."
        : null,
    })),
  })

  console.log(`  → ${unique.length} source sites (${autoCount} automated, ${manualCount} manual)`)
}

async function main() {
  console.log("=== Seeding database ===")
  await seedLocations()
  await seedSearchTemplates()
  await seedGlobalSearchTerms()
  await seedSourceSites()
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
