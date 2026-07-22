import { prisma } from "@/lib/prisma"

const CANONICAL: Array<{ city: string; state: string; name: string }> = [
  { city: "Chester", state: "PA", name: "Subaru Park" },
  { city: "Philadelphia", state: "PA", name: "Philadelphia Convention Center" },
  { city: "Philadelphia", state: "PA", name: "Philadelphia Marriott Downtown" },
  { city: "Philadelphia", state: "PA", name: "Loews Philadelphia Hotel" },
  { city: "Philadelphia", state: "PA", name: "Element Philadelphia Downtown" },
  { city: "Philadelphia", state: "PA", name: "Hyatt Centric Center City Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Sheraton Philadelphia Downtown Hotel" },
  { city: "Philadelphia", state: "PA", name: "W Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "The Bellevue Hotel Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Cira Centre Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "The Logan Philadelphia Hotel" },
  { city: "Philadelphia", state: "PA", name: "Four Seasons Hotel Philadelphia at Comcast Center" },
  { city: "Philadelphia", state: "PA", name: "Sofitel Philadelphia at Rittenhouse Square" },
  { city: "Philadelphia", state: "PA", name: "The Ritz-Carlton Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "The Union League of Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Sonesta Hotel Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Philadelphia Marriott Old City" },
  { city: "Philadelphia", state: "PA", name: "Kimpton Hotel Palomar Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Kimpton Hotel Monaco Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Live! casino and Hotel Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Hilton Philadelphia at Penn's Landing" },
  { city: "Philadelphia", state: "PA", name: "Philadelphia Airport Marriott" },
  { city: "Philadelphia", state: "PA", name: "Holiday Inn & Suites Philadelphia W - Drexel Hill" },
  { city: "Philadelphia", state: "PA", name: "Temple University Conference Center" },
  { city: "Philadelphia", state: "PA", name: "The Warwick Rittenhouse Square" },
  { city: "Philadelphia", state: "PA", name: "The Notary Hotel Philadelphia" },
  { city: "Philadelphia", state: "PA", name: "Other Philadelphia Venues (Various)" },
  { city: "Philadelphia", state: "PA", name: "Stateside Live!" },
  { city: "Philadelphia", state: "PA", name: "Independence Seaport Museum" },
  { city: "Philadelphia", state: "PA", name: "Pennsylvania Academy of the Fine Arts" },
  { city: "Philadelphia", state: "PA", name: "The Crystal Tea Room" },
  { city: "Philadelphia", state: "PA", name: "The Liberty View" },
  { city: "Philadelphia", state: "PA", name: "Valley Forge Casino Resort" },
  { city: "Oaks", state: "PA", name: "Greater Philadelphia Expo Center at Oaks" },
  { city: "Washington DC", state: "DC", name: "Walter E. Washington Convention Center" },
  { city: "Washington DC", state: "DC", name: "Marriott Marquis Washington DC" },
  { city: "Washington DC", state: "DC", name: "Washington Hilton" },
  { city: "Washington DC", state: "DC", name: "Renaissance Washington DC Downtown Hotel" },
  { city: "Washington DC", state: "DC", name: "Grand Hyatt Washington" },
  { city: "Washington DC", state: "DC", name: "Omni Shoreham Hotel Washington DC" },
  { city: "Washington DC", state: "DC", name: "JW Marriott Washington DC" },
  { city: "Washington DC", state: "DC", name: "Washington DC Annual Events (Various Venues)" },
  { city: "Washington DC", state: "DC", name: "Ronald Reagan Building" },
  { city: "Washington DC", state: "DC", name: "America's Main Street" },
  { city: "Bethesda", state: "MD", name: "Bethesda North Marriott Hotel & Conference Center" },
  { city: "Bethesda", state: "MD", name: "The Bethesdan Hotel (Tapestry Collection by Hilton)" },
  { city: "Bethesda", state: "MD", name: "Hyatt Regency Bethesda" },
  { city: "National Harbor", state: "MD", name: "Gaylord National Resort & Convention Center" },
  { city: "National Harbor", state: "MD", name: "Harborside Hotel National Harbor" },
  { city: "National Harbor", state: "MD", name: "MGM National Harbor" },
  { city: "Atlantic City", state: "NJ", name: "Atlantic City Convention Center" },
  { city: "Baltimore", state: "MD", name: "Baltimore Convention Center" },
  { city: "Baltimore", state: "MD", name: "Hilton Baltimore Inner Harbor" },
  { city: "Baltimore", state: "MD", name: "Baltimore Marriott Inner Harbor at Camden Yards" },
  { city: "Baltimore", state: "MD", name: "Four Seasons Hotel Baltimore" },
  { city: "Baltimore", state: "MD", name: "Embassy Suites by Hilton Baltimore Inner Harbor" },
  { city: "Baltimore", state: "MD", name: "Hyatt Regency Baltimore Inner Harbor" },
  { city: "Baltimore", state: "MD", name: "Baltimore Marriott Waterfront" },
  { city: "Baltimore", state: "MD", name: "Renaissance Baltimore Harborplace Hotel" },
  { city: "Baltimore", state: "MD", name: "Courtyard by Marriott Baltimore Downtown/Inner Harbor" },
  { city: "Baltimore", state: "MD", name: "Hilton Garden Inn Baltimore Inner Harbor" },
  { city: "Baltimore", state: "MD", name: "Hyatt Place Baltimore Inner Harbor" },
  { city: "Baltimore", state: "MD", name: "Hotel Indigo Baltimore" },
  { city: "Baltimore", state: "MD", name: "Lord Baltimore Hotel" },
  { city: "Baltimore", state: "MD", name: "Hampton Inn Baltimore - Downtown Convention Center" },
  { city: "Baltimore", state: "MD", name: "The Rita Rossi Colwell Center" },
  { city: "Baltimore", state: "MD", name: "Murphy Fine Arts Center" },
  { city: "Baltimore", state: "MD", name: "Chesapeake Arena" },
  { city: "Baltimore", state: "MD", name: "Graffiti Warehouse" },
  { city: "Ellicott City", state: "MD", name: "Turf Valley Resort" },
  { city: "West Friendship", state: "MD", name: "Howard County Fairgrounds" },
  { city: "Upper Marlboro", state: "MD", name: "The Show Place Arena" },
  { city: "Wilmington DE", state: "DE", name: "Chase Center on the Riverfront" },
  { city: "Wilmington DE", state: "DE", name: "Hotel DuPont" },
  { city: "Wilmington DE", state: "DE", name: "DoubleTree by Hilton Wilmington" },
  { city: "Wilmington DE", state: "DE", name: "76ers Fieldhouse" },
]

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  if (a.includes(b) || b.includes(a)) {
    const longer = a.length > b.length ? a : b
    const shorter = a.length > b.length ? b : a
    return 0.7 + 0.3 * (shorter.length / longer.length)
  }
  const aWords = new Set(a.split(/\s+/))
  const bWords = new Set(b.split(/\s+/))
  const intersect = [...aWords].filter((w) => bWords.has(w)).length
  const union = new Set([...aWords, ...bWords]).size
  if (union === 0) return 0
  const jaccard = intersect / union
  return jaccard * 0.5
}

async function main() {
  const DRY_RUN = !process.argv.includes("--confirm")
  console.log(`[normalizeVenues] DRY_RUN=${DRY_RUN}\n`)

  const venues = await prisma.location.findMany({
    where: { type: "VENUE", active: true },
    select: { id: true, name: true, city: true, state: true },
  })

  let updated = 0
  let skipped = 0

  for (const venue of venues) {
    const match = CANONICAL.find((c) => {
      const score = similarity(venue.name, c.name)
      return score >= 0.5
    })

    if (!match) {
      skipped++
      continue
    }

    if (match.name === venue.name) {
      skipped++
      continue
    }

    console.log(`[normalizeVenues] "${venue.name}" → "${match.name}"`)
    if (!DRY_RUN) {
      await prisma.location.update({
        where: { id: venue.id },
        data: { name: match.name },
      })
    }
    updated++
  }

  console.log(`\n[normalizeVenues] Results: ${updated} updated, ${skipped} unchanged/skipped`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
