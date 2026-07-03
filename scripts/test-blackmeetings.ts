import "dotenv/config"
import { scrapeBMEvents, scrapeBMVenues } from "../lib/scrapers/blackmeetings"

async function main() {
  const what = process.argv[2] ?? "events"

  if (what === "venues") {
    console.log("Testing venue scraper...")
    const venues = await scrapeBMVenues({ maxVenues: 3 })
    console.log(JSON.stringify(venues, null, 2))
  } else {
    console.log("Testing event scraper (Current Events)...")
    const events = await scrapeBMEvents({
      sections: ["current-events"],
      maxDetailPages: 3,
    })
    console.log(JSON.stringify(events, null, 2))
  }
}

main().catch(console.error)
