import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const tablenames = [
    "event_contacts",
    "events",
    "search_terms",
    "search_templates",
    "source_site_configs",
    "source_sites",
    "ingestion_schedules",
    "ingestion_runs",
    "ingest_configs",
    "locations",
  ]

  for (const table of tablenames) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`)
    console.log(`  cleared: ${table}`)
  }

  console.log("\nAll tables cleared.")
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
