import "dotenv/config"
import { checkACAHealth } from "../lib/scrapers/allconferencealert"

// Candidate slugs for every city in your venues.json — guesses where unverified.
// Run this, read the console output, then only keep slugs that came back ok=true
// with a real status (200/301/302) in the CITY_TO_SLUG map in ingest-aca.ts.
const BASE = "https://allconferencealert.net/cities"

const candidates = [
  "washington",
  "philadelphia",
  "oaks",
  "bethesda",
  "nationalharbor",
  "atlanticcity",
  "baltimore",
  "uppermarlboro",
  "wilmington",
  "wilmingtonde",
  "chester",
]

async function main() {
  const urls = candidates.map((slug) => `${BASE}/${slug}.php`)
  await checkACAHealth(urls)
}

main().catch((e) => {
  console.error("[Health] Fatal:", e)
  process.exit(1)
})
