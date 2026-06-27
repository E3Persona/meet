import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { EVENT_TYPE_KEYWORDS } from "../lib/constants/events"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const DEFAULT_LOCATIONS = [
  { name: "Gaylord National Harbor", city: "National Harbor", state: "MD", sourceUrl: "https://www.marriott.com/en-us/hotels/wasgn-gaylord-national-resort-and-convention-center/overview/" },
  { name: "Gaylord Opryland", city: "Nashville", state: "TN", sourceUrl: "https://www.marriott.com/en-us/hotels/bnkgi-gaylord-opryland-resort-and-convention-center/overview/" },
  { name: "Gaylord Texan", city: "Grapevine", state: "TX", sourceUrl: "https://www.marriott.com/en-us/hotels/dalgt-gaylord-texan-resort-and-convention-center/overview/" },
  { name: "Gaylord Palms", city: "Kissimmee", state: "FL", sourceUrl: "https://www.marriott.com/en-us/hotels/mcogp-gaylord-palms-resort-and-convention-center/overview/" },
  { name: "McCormick Place", city: "Chicago", state: "IL", sourceUrl: "https://www.mccormickplace.com/" },
  { name: "Javits Center", city: "New York", state: "NY", sourceUrl: "https://www.javitscenter.com/" },
  { name: "Moscone Center", city: "San Francisco", state: "CA", sourceUrl: "https://www.moscone.com/" },
  { name: "The Venetian Expo", city: "Las Vegas", state: "NV", sourceUrl: "https://www.venetian.com/las-vegas/conventions/" },
  { name: "Mandalay Bay Convention Center", city: "Las Vegas", state: "NV", sourceUrl: "https://www.mandalaybay.com/entertainment/convention-center" },
  { name: "Orange County Convention Center", city: "Orlando", state: "FL", sourceUrl: "https://www.occc.net/" },
  { name: "Boston Convention and Exhibition Center", city: "Boston", state: "MA", sourceUrl: "https://www.thebcec.com/" },
  { name: "Georgia World Congress Center", city: "Atlanta", state: "GA", sourceUrl: "https://www.gwcca.org/" },
  { name: "Kay Bailey Hutchison Convention Center", city: "Dallas", state: "TX", sourceUrl: "https://www.dallasconventioncenter.com/" },
  { name: "George R. Brown Convention Center", city: "Houston", state: "TX", sourceUrl: "https://www.ghvb.com/george-r-brown-convention-center" },
  { name: "Pennsylvania Convention Center", city: "Philadelphia", state: "PA", sourceUrl: "https://www.pennventioncenter.com/" },
  { name: "Seattle Convention Center", city: "Seattle", state: "WA", sourceUrl: "https://www.seattleconventioncenter.com/" },
  { name: "Colorado Convention Center", city: "Denver", state: "CO", sourceUrl: "https://www.denverconvention.com/" },
  { name: "Music City Center", city: "Nashville", state: "TN", sourceUrl: "https://www.musiccitycenter.org/" },
  { name: "San Diego Convention Center", city: "San Diego", state: "CA", sourceUrl: "https://www.sdcventures.com/convention-center/" },
  { name: "Huntington Place", city: "Detroit", state: "MI", sourceUrl: "https://www.huntingtonplace.com/" },
]

async function main() {
  console.log("Seeding database...")

  for (const loc of DEFAULT_LOCATIONS) {
    const existing = await prisma.location.findFirst({ where: { name: loc.name } })
    if (existing) {
      console.log(`  skip: ${loc.name} (already exists)`)
      continue
    }
    await prisma.location.create({
      data: {
        ...loc,
        searchTerms: {
          create: EVENT_TYPE_KEYWORDS.map((keyword) => ({ keyword })),
        },
      },
    })
    console.log(`  created: ${loc.name} (${EVENT_TYPE_KEYWORDS.length} search terms)`)
  }

  console.log(`\nDone! Seeded ${DEFAULT_LOCATIONS.length} locations.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
