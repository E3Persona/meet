import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { SearchQuery, runSearchScraper } from "@/lib/ingest/search-pipeline"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Pull two real locations to test location-anchored queries
  const locations = await prisma.location.findMany({
    where: { active: true },
    take: 2,
  })

  if (locations.length < 2) {
    console.error(
      "Need at least 2 active locations in the DB to run this test."
    )
    process.exit(1)
  }

  const testQueries: SearchQuery[] = [
    // ── 2 location-based ──
    {
      locationId: locations[0].id,
      locationName: locations[0].name,
      monthLabel: "July 2026",
      query: `events at ${locations[0].name}`,
    },
    {
      locationId: locations[1].id,
      locationName: locations[1].name,
      monthLabel: "July 2026",
      query: `${locations[1].city ?? locations[1].name} convention listings`,
    },
    // ── 2 general (no location tie) ──
    {
      locationId: null,
      locationName: "General",
      monthLabel: "July 2026",
      query: "upcoming tradeshow in Philadelphia",
    },
    {
      locationId: null,
      locationName: "General",
      monthLabel: "July 2026",
      query: "CME Credit conference 2026",
    },
  ]

  console.log(`Testing with ${testQueries.length} queries:`)
  testQueries.forEach((q, i) =>
    console.log(`  ${i + 1}. [${q.locationName}] "${q.query}"`)
  )

  const runId = `test-${Date.now()}`
  const result = await runSearchScraper(testQueries, runId, {
    searchConcurrency: 2, // keep low for testing so you can read logs
    scrapeConcurrency: 2,
    dryRun: true,
  })

  console.log("\n=== Test result ===")
  console.log(result)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
