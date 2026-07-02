import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../lib/generated/prisma/client"
import { EVENT_TYPE_KEYWORDS } from "../lib/constants/events"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// ─── Original seed locations (national convention centers) ────────────────────

const DEFAULT_LOCATIONS = [
  {
    name: "Gaylord National Harbor",
    city: "National Harbor",
    state: "MD",
    sourceUrl:
      "https://www.marriott.com/en-us/hotels/wasgn-gaylord-national-resort-and-convention-center/overview/",
  },
  {
    name: "Gaylord Opryland",
    city: "Nashville",
    state: "TN",
    sourceUrl:
      "https://www.marriott.com/en-us/hotels/bnkgi-gaylord-opryland-resort-and-convention-center/overview/",
  },
  {
    name: "Gaylord Texan",
    city: "Grapevine",
    state: "TX",
    sourceUrl:
      "https://www.marriott.com/en-us/hotels/dalgt-gaylord-texan-resort-and-convention-center/overview/",
  },
  {
    name: "Gaylord Palms",
    city: "Kissimmee",
    state: "FL",
    sourceUrl:
      "https://www.marriott.com/en-us/hotels/mcogp-gaylord-palms-resort-and-convention-center/overview/",
  },
  {
    name: "McCormick Place",
    city: "Chicago",
    state: "IL",
    sourceUrl: "https://www.mccormickplace.com/",
  },
  {
    name: "Javits Center",
    city: "New York",
    state: "NY",
    sourceUrl: "https://www.javitscenter.com/",
  },
  {
    name: "Moscone Center",
    city: "San Francisco",
    state: "CA",
    sourceUrl: "https://www.moscone.com/",
  },
  {
    name: "The Venetian Expo",
    city: "Las Vegas",
    state: "NV",
    sourceUrl: "https://www.venetian.com/las-vegas/conventions/",
  },
  {
    name: "Mandalay Bay Convention Center",
    city: "Las Vegas",
    state: "NV",
    sourceUrl: "https://www.mandalaybay.com/entertainment/convention-center",
  },
  {
    name: "Orange County Convention Center",
    city: "Orlando",
    state: "FL",
    sourceUrl: "https://www.occc.net/",
  },
  {
    name: "Boston Convention and Exhibition Center",
    city: "Boston",
    state: "MA",
    sourceUrl: "https://www.thebcec.com/",
  },
  {
    name: "Georgia World Congress Center",
    city: "Atlanta",
    state: "GA",
    sourceUrl: "https://www.gwcca.org/",
  },
  {
    name: "Kay Bailey Hutchison Convention Center",
    city: "Dallas",
    state: "TX",
    sourceUrl: "https://www.dallasconventioncenter.com/",
  },
  {
    name: "George R. Brown Convention Center",
    city: "Houston",
    state: "TX",
    sourceUrl: "https://www.ghvb.com/george-r-brown-convention-center",
  },
  {
    name: "Pennsylvania Convention Center",
    city: "Philadelphia",
    state: "PA",
    sourceUrl: "https://www.pennventioncenter.com/",
  },
  {
    name: "Seattle Convention Center",
    city: "Seattle",
    state: "WA",
    sourceUrl: "https://www.seattleconventioncenter.com/",
  },
  {
    name: "Colorado Convention Center",
    city: "Denver",
    state: "CO",
    sourceUrl: "https://www.denverconvention.com/",
  },
  {
    name: "Music City Center",
    city: "Nashville",
    state: "TN",
    sourceUrl: "https://www.musiccitycenter.org/",
  },
  {
    name: "San Diego Convention Center",
    city: "San Diego",
    state: "CA",
    sourceUrl: "https://www.sdcventures.com/convention-center/",
  },
  {
    name: "Huntington Place",
    city: "Detroit",
    state: "MI",
    sourceUrl: "https://www.huntingtonplace.com/",
  },
]

// ─── Venue master list (from "ALL VENUES — Master List" sheet) ──────────────
// Region headers parsed from the spreadsheet. Each entry: { name, shortName, city, state, address }
// Duplicate "Renaissance Baltimore Harborplace Hotel" (row 75) excluded — row 71 is canonical.

const VENUE_MASTER_LIST: {
  name: string
  shortName: string | null
  city: string
  state: string
  address: string
}[] = [
  // ── Chester, PA ──
  {
    name: "Subaru Park",
    shortName: "Subaru Park",
    city: "Chester",
    state: "PA",
    address: "1 Stadium Drive Chester, PA 19013",
  },

  // ── Philadelphia, PA ──
  {
    name: "Philadelphia Convention Center",
    shortName: "Philadelphia Convention Center",
    city: "Philadelphia",
    state: "PA",
    address: "1101 Arch Street, Philadelphia, PA 19107",
  },
  {
    name: "Philadelphia Marriott Downtown",
    shortName: "Marriott",
    city: "Philadelphia",
    state: "PA",
    address: "1201 Market Street, Philadelphia, PA 19107",
  },
  {
    name: "Loews Philadelphia Hotel",
    shortName: "Lowes Hotel",
    city: "Philadelphia",
    state: "PA",
    address: "1200 Market Street, Philadelphia, PA 19107",
  },
  {
    name: "Element Philadelphia Downtown",
    shortName: "Element Philadelphia",
    city: "Philadelphia",
    state: "PA",
    address: "1441 Chestnut Street, Philadelphia, PA 19102",
  },
  {
    name: "Hyatt Centric Center City Philadelphia",
    shortName: "Hyatt CC",
    city: "Philadelphia",
    state: "PA",
    address: "1620 Chancellor Street, Philadelphia, PA 19103",
  },
  {
    name: "Sheraton Philadelphia Downtown Hotel",
    shortName: "Sheraton Philadelphia Downtown",
    city: "Philadelphia",
    state: "PA",
    address: "201 North 17th Street, Philadelphia, PA 19103",
  },
  {
    name: "W Philadelphia",
    shortName: "W Philadelphia",
    city: "Philadelphia",
    state: "PA",
    address: "1439 Chestnut St, Philadelphia, PA 19102",
  },
  {
    name: "The Bellevue Hotel Philadelphia",
    shortName: "The Bellevue",
    city: "Philadelphia",
    state: "PA",
    address: "200 South Broad Street, Philadelphia, PA 19102",
  },
  {
    name: "Cira Centre Philadelphia",
    shortName: "Circa Center",
    city: "Philadelphia",
    state: "PA",
    address: "2929 Arch Street, Philadelphia, PA 19104",
  },
  {
    name: "The Logan Philadelphia Hotel",
    shortName: "The Logan",
    city: "Philadelphia",
    state: "PA",
    address: "One Logan Square, Philadelphia, PA 19103",
  },
  {
    name: "Four Seasons Hotel Philadelphia at Comcast Center",
    shortName: "Four Seasons",
    city: "Philadelphia",
    state: "PA",
    address: "1 N. 19th Street, Philadelphia, PA 19103",
  },
  {
    name: "Sofitel Philadelphia at Rittenhouse Square",
    shortName: "Sofitel",
    city: "Philadelphia",
    state: "PA",
    address: "120 South 17th Street, Philadelphia, PA 19103",
  },
  {
    name: "The Ritz-Carlton Philadelphia",
    shortName: "The Ritz-Carlton",
    city: "Philadelphia",
    state: "PA",
    address: "10 Avenue of the Arts, Philadelphia, PA 19102",
  },
  {
    name: "The Union League of Philadelphia",
    shortName: "Union League",
    city: "Philadelphia",
    state: "PA",
    address: "140 South Broad Street, Philadelphia, PA 19102",
  },
  {
    name: "Sonesta Hotel Philadelphia",
    shortName: "Sonesta",
    city: "Philadelphia",
    state: "PA",
    address: "1800 Market Street, Philadelphia, PA 19103",
  },
  {
    name: "Philadelphia Marriott Old City",
    shortName: "Marriott Old City",
    city: "Philadelphia",
    state: "PA",
    address: "One Dock Street, Philadelphia, PA 19106",
  },
  {
    name: "Kimpton Hotel Palomar Philadelphia",
    shortName: "Kimpton - Palamor",
    city: "Philadelphia",
    state: "PA",
    address: "117 South 17th Street, Philadelphia, PA 19103",
  },
  {
    name: "Kimpton Hotel Monaco Philadelphia",
    shortName: "Kimpton-Monaco",
    city: "Philadelphia",
    state: "PA",
    address: "433 Chestnut Street, Philadelphia, PA 19106",
  },
  {
    name: "Live! Casino and Hotel Philadelphia",
    shortName: "Live Casino",
    city: "Philadelphia",
    state: "PA",
    address: "900 Packer Ave, Philadelphia, PA 19148",
  },
  {
    name: "Hilton Philadelphia at Penn's Landing",
    shortName: "Hilton Penns Landing",
    city: "Philadelphia",
    state: "PA",
    address: "201 S Christopher Columbus Blvd, Philadelphia, PA 19106",
  },
  {
    name: "Philadelphia Airport Marriott",
    shortName: "Airport Marriott",
    city: "Philadelphia",
    state: "PA",
    address: "One Arrivals Road, Philadelphia International Airport, PA 19153",
  },
  {
    name: "Holiday Inn & Suites Philadelphia W - Drexel Hill",
    shortName: "Holiday - Drexel Hill",
    city: "Philadelphia",
    state: "PA",
    address: "5400 Ferne Blvd., Drexel Hill, PA 19026",
  },
  {
    name: "Temple University Conference Center",
    shortName: "Temple University",
    city: "Philadelphia",
    state: "PA",
    address: "1925 N 12th St, Philadelphia, PA 19122",
  },
  {
    name: "The Warwick Rittenhouse Square",
    shortName: "Warwick Hotel",
    city: "Philadelphia",
    state: "PA",
    address: "220 S 17th Street, Philadelphia, PA 19103",
  },
  {
    name: "The Notary Hotel Philadelphia",
    shortName: "Notary Hotel",
    city: "Philadelphia",
    state: "PA",
    address: "21 N Juniper St, Philadelphia, PA 19107",
  },
  {
    name: "Other Philadelphia Venues (Various)",
    shortName: "Others Philadelphia",
    city: "Philadelphia",
    state: "PA",
    address: "Philadelphia, PA",
  },
  {
    name: "Stateside Live!",
    shortName: "Stateside Live!",
    city: "Philadelphia",
    state: "PA",
    address: "1100 Pattison Ave, Philadelphia, PA 19148",
  },
  {
    name: "Independence Seaport Museum",
    shortName: null,
    city: "Philadelphia",
    state: "PA",
    address: "211 South Columbus Boulevard, Philadelphia, PA 19106",
  },
  {
    name: "Pennsylvania Academy of the Fine Arts",
    shortName: null,
    city: "Philadelphia",
    state: "PA",
    address: "118-128 North Broad Street, Philadelphia, PA 19102",
  },
  {
    name: "The Crystal Tea Room",
    shortName: null,
    city: "Philadelphia",
    state: "PA",
    address:
      "100 Penn Square East, 9th. Floor, The Wanamaker Building, Philadelphia, PA 19107",
  },
  {
    name: "The Liberty View",
    shortName: null,
    city: "Philadelphia",
    state: "PA",
    address: "One North Independence Mall West, Philadelphia, PA 19106",
  },

  // ── Oaks, PA ──
  {
    name: "Greater Philadelphia Expo Center at Oaks",
    shortName: "Oaks Expo Center",
    city: "Oaks",
    state: "PA",
    address: "100 Station Avenue, Oaks, PA 19456",
  },

  // ── Valley Forge, PA ──
  {
    name: "Valley Forge Casino Resort",
    shortName: "VF Casino",
    city: "Valley Forge",
    state: "PA",
    address: "1160 First Avenue, King of Prussia, PA 19406",
  },

  // ── Washington DC ──
  {
    name: "Walter E. Washington Convention Center",
    shortName: "DC Convention Center",
    city: "Washington DC",
    state: "DC",
    address: "801 Mount Vernon Pl NW, Washington, DC 20001",
  },
  {
    name: "Marriott Marquis Washington DC",
    shortName: "Marriott Marquis",
    city: "Washington DC",
    state: "DC",
    address: "901 Massachusetts Ave NW, Washington, DC 20001",
  },
  {
    name: "Washington Hilton",
    shortName: "Hilton",
    city: "Washington DC",
    state: "DC",
    address: "1919 Connecticut Ave NW, Washington, DC 20009",
  },
  {
    name: "Renaissance Washington DC Downtown Hotel",
    shortName: "Renaissance",
    city: "Washington DC",
    state: "DC",
    address: "999 9th St NW, Washington, DC 20001",
  },
  {
    name: "Grand Hyatt Washington",
    shortName: "Grand Hyatt Washington",
    city: "Washington DC",
    state: "DC",
    address: "1000 H St NW, Washington, DC 20001",
  },
  {
    name: "Omni Shoreham Hotel Washington DC",
    shortName: "Omni Shoreham Hotel",
    city: "Washington DC",
    state: "DC",
    address: "2500 Calvert St NW, Washington, DC 20008",
  },
  {
    name: "JW Marriott Washington DC",
    shortName: "JW Marriott",
    city: "Washington DC",
    state: "DC",
    address: "1331 Pennsylvania Ave NW, Washington, DC 20004",
  },
  {
    name: "Washington DC Annual Events (Various Venues)",
    shortName: "Annual Events DC",
    city: "Washington DC",
    state: "DC",
    address: "Washington, DC",
  },
  {
    name: "Ronald Reagan Building",
    shortName: "Reagan Building",
    city: "Washington DC",
    state: "DC",
    address: "1300 Pennsylvania Ave NW, Washington, DC 20004",
  },
  {
    name: "America's Main Street",
    shortName: "America's Main Street",
    city: "Washington DC",
    state: "DC",
    address: "Pennsylvania Avenue NW, Washington, D.C.",
  },

  // ── Bethesda, MD ──
  {
    name: "Bethesda North Marriott Hotel & Conference Center",
    shortName: "Bethesda",
    city: "Bethesda",
    state: "MD",
    address: "5701 Marinelli Road, North Bethesda, MD 20852",
  },
  {
    name: "The Bethesdan Hotel (Tapestry Collection by Hilton)",
    shortName: "Bethesdan",
    city: "Bethesda",
    state: "MD",
    address: "8120 Wisconsin Ave, Bethesda, MD 20814",
  },
  {
    name: "Hyatt Regency Bethesda",
    shortName: "Hyatt",
    city: "Bethesda",
    state: "MD",
    address: "7400 Wisconsin Avenue, Bethesda, MD 20814",
  },

  // ── National Harbor, MD ──
  {
    name: "Gaylord National Resort & Convention Center",
    shortName: "Gaylord",
    city: "National Harbor",
    state: "MD",
    address: "201 Waterfront Street, National Harbor, MD 20745",
  },
  {
    name: "Harborside Hotel National Harbor",
    shortName: "Harborside",
    city: "National Harbor",
    state: "MD",
    address: "6400 Oxon Hill Rd, National Harbor, MD 20745",
  },
  {
    name: "MGM National Harbor",
    shortName: "MGM",
    city: "National Harbor",
    state: "MD",
    address: "101 MGM National Avenue, Oxon Hill, MD 20745",
  },

  // ── New Jersey ──
  {
    name: "Atlantic City Convention Center",
    shortName: "AC",
    city: "Atlantic City",
    state: "NJ",
    address: "1 Convention Blvd, Atlantic City, NJ 08401",
  },

  // ── Baltimore, MD ──
  {
    name: "Baltimore Convention Center",
    shortName: "Baltimore Convention Center",
    city: "Baltimore",
    state: "MD",
    address: "1 West Pratt Street, Baltimore, MD 21201",
  },
  {
    name: "Hilton Baltimore Inner Harbor",
    shortName: "Hilton",
    city: "Baltimore",
    state: "MD",
    address: "401 West Pratt Street, Baltimore, MD 21201",
  },
  {
    name: "Baltimore Marriott Inner Harbor at Camden Yards",
    shortName: "Marriott IH",
    city: "Baltimore",
    state: "MD",
    address: "110 South Eutaw Street, Baltimore, MD 21201",
  },
  {
    name: "Four Seasons Hotel Baltimore",
    shortName: "Four Seasons",
    city: "Baltimore",
    state: "MD",
    address: "200 International Drive, Baltimore, MD 21202",
  },
  {
    name: "Embassy Suites by Hilton Baltimore Inner Harbor",
    shortName: "Embassy Suites",
    city: "Baltimore",
    state: "MD",
    address: "222 St. Paul Place, Baltimore, MD 21202",
  },
  {
    name: "Hyatt Regency Baltimore Inner Harbor",
    shortName: "Hyatt Regency IH",
    city: "Baltimore",
    state: "MD",
    address: "300 Light Street, Baltimore, MD 21202",
  },
  {
    name: "Baltimore Marriott Waterfront",
    shortName: "Marriott Waterfront",
    city: "Baltimore",
    state: "MD",
    address: "700 Aliceanna Street, Baltimore, MD 21202",
  },
  {
    name: "Renaissance Baltimore Harborplace Hotel",
    shortName: "Renaissance BHH",
    city: "Baltimore",
    state: "MD",
    address: "202 E Pratt St, Baltimore, MD 21202",
  },
  {
    name: "Courtyard by Marriott Baltimore Downtown/Inner Harbor",
    shortName: "Courtyard Marriott",
    city: "Baltimore",
    state: "MD",
    address: "1000 Aliceanna Street, Harbor East, Baltimore, MD 21202",
  },
  {
    name: "Hilton Garden Inn Baltimore Inner Harbor",
    shortName: "Hilton Garden Inn",
    city: "Baltimore",
    state: "MD",
    address: "625 South President Street, Harbor East, Baltimore, MD 21202",
  },
  {
    name: "Hyatt Place Baltimore Inner Harbor",
    shortName: "Hyatt Place IH",
    city: "Baltimore",
    state: "MD",
    address: "511 South Central Avenue, Little Italy, Baltimore, MD 21202",
  },
  {
    name: "Hotel Indigo Baltimore",
    shortName: "Hotel Indigo",
    city: "Baltimore",
    state: "MD",
    address: "24 West Franklin Street, Baltimore, MD 21201",
  },
  {
    name: "Lord Baltimore Hotel",
    shortName: "Lord Baltimore",
    city: "Baltimore",
    state: "MD",
    address: "20 W Baltimore St, Baltimore, MD 21201",
  },
  {
    name: "Hampton Inn Baltimore - Downtown Convention Center",
    shortName: "Hampton Inn",
    city: "Baltimore",
    state: "MD",
    address: "550 W Fayette St, Baltimore, MD 21201",
  },
  {
    name: "The Rita Rossi Colwell Center",
    shortName: "Rita",
    city: "Baltimore",
    state: "MD",
    address: "701 E Pratt St, Baltimore, MD 21202",
  },
  {
    name: "Murphy Fine Arts Center",
    shortName: "Murphy Fine Arts Center",
    city: "Baltimore",
    state: "MD",
    address: "2201 Argonne Dr Baltimore, MD 21251",
  },
  {
    name: "Chesapeake Arena",
    shortName: "Chesapeake Arena",
    city: "Baltimore",
    state: "MD",
    address: "1000 Hilltop Circle, Baltimore, MD 21250",
  },
  {
    name: "Graffiti warehouse",
    shortName: "Graffiti warehouse",
    city: "Baltimore",
    state: "MD",
    address: "128 W North Ave, Baltimore, MD 21201",
  },
  {
    name: "Turf Valley Resort",
    shortName: "Turf Valley",
    city: "Ellicott City",
    state: "MD",
    address: "2700 Turf Valley Rd, Ellicott City, MD 21042",
  },
  {
    name: "Howard County Fairgrounds",
    shortName: "H.C. Fairgrounds",
    city: "West Friendship",
    state: "MD",
    address: "2210 Fairgrounds Rd, West Friendship, MD 21794",
  },

  // ── Upper Marlboro, MD ──
  {
    name: "The Show Place Arena",
    shortName: "The Show Place Arena",
    city: "Upper Marlboro",
    state: "MD",
    address: "14900 Pennsylvania Avenue Upper Marlboro, Maryland",
  },

  // ── Wilmington, DE ──
  {
    name: "Chase Center on the Riverfront",
    shortName: "Chase Center on the Riverfront",
    city: "Wilmington",
    state: "DE",
    address: "815 Justison St., Wilmington, DE 19801",
  },
  {
    name: "Hotel DuPont",
    shortName: "Hotel DuPont",
    city: "Wilmington",
    state: "DE",
    address: "42 West 11th St., Wilmington, DE 19801",
  },
  {
    name: "DoubleTree by Hilton Wilmington",
    shortName: "DoubleTree by Hilton",
    city: "Wilmington",
    state: "DE",
    address: "4727 Concord Pike, Wilmington, DE 19803",
  },
  {
    name: "76ers Fieldhouse",
    shortName: "76ers Fieldhouse",
    city: "Wilmington",
    state: "DE",
    address: "401 Garasches Ln, Wilmington, DE 19801",
  },
]

// ─── Search Templates (from "Search Phrases & Sources" sheet) ────────────────
// Rows 3-21: templates with {CITY}, {VENUE}, {MONTH}, {YEAR} placeholders
// Rows 22-51: hardcoded concrete search phrases (also seeded as templates)

const SEARCH_TEMPLATES: { template: string }[] = [
  // ── Placeholder templates (expanded per-location at ingest time) ──
  { template: "{CITY} meeting listings" },
  { template: "{CITY} convention listings" },
  { template: "{CITY} trade show listings" },
  { template: "{CITY} business event listings" },
  { template: "{CITY} professional event calendar" },
  { template: "{CITY} expo listings" },
  { template: "{CITY} conference listings" },
  { template: "{CITY} industry event calendar" },
  { template: "upcoming meetings in {CITY}" },
  { template: "upcoming conventions in {CITY}" },
  { template: "{CITY} convention schedule" },
  { template: "national conventions {CITY}" },
  { template: "upcoming trade shows in {CITY}" },
  { template: "{CITY} trade show calendar" },
  { template: "events at {VENUE}" },
  { template: "{MONTH} {YEAR} conference {VENUE}" },
  { template: "{MONTH} {YEAR} convention {VENUE}" },
  { template: "{MONTH} {YEAR} trade show {VENUE}" },
  { template: "{MONTH} {YEAR} meeting {VENUE}" },

  // ── Hardcoded concrete search phrases (run as-is, no expansion needed) ──
  { template: "upcoming tradeshow in Philadelphia" },
  { template: "Symposium Baltimore Convention Center" },
  { template: "Summit Baltimore Convention Center" },
  { template: "Sales Meeting Baltimore Convention Center" },
  { template: "Financial Meeting Baltimore Convention Center" },
  { template: "Congress Baltimore Convention Center" },
  { template: "Consumer Show Baltimore Convention Center" },
  { template: "Association Baltimore Convention Center" },
  { template: "Association Meeting Baltimore Convention Center" },
  { template: "Clinical Meeting Baltimore Convention Center" },
  { template: "Public Show Baltimore Convention Center" },
  { template: "Training Summit Baltimore Convention Center" },
  { template: "Annual Meeting Baltimore Convention Center" },
  { template: "Forum Baltimore Convention Center" },
  { template: "Exposition Baltimore Convention Center" },
  { template: "User Group Baltimore Convention Center" },
  { template: "Compliance Baltimore Convention Center" },
  { template: "Road Show" },
  { template: "Food Event Baltimore Convention Center" },
  { template: "Festival Baltimore Convention Center" },
  { template: "Wine Event Baltimore Convention Center" },
  { template: "Convocation Baltimore Convention Center" },
  { template: "Assembly Baltimore Convention Center" },
  { template: "Forum Baltimore Convention Center" },
  { template: "CME Credit" },
  { template: "CLE Credit" },
  { template: "Caucus Baltimore Convention Center" },
  { template: "Roundtable Baltimore Convention Center" },
  { template: "Promotional Tour" },
  { template: "Sampling Tour" },
]

// ─── Source Sites (from "Event Data Sources" sheet) ──────────────────────────
// Each site researched and assigned a scrapeMode + urlPattern + notes.
// scrapeMode determines HOW we extract events from the site.
// urlPattern is a regex matched against Tavily results to skip known sources in Phase 2.
// notes are LLM instructions injected into the extraction prompt for that site.

const SOURCE_SITES: {
  name: string
  url: string | null
  urlPattern: string | null
  scrapeMode: "auto" | "calendar" | "directory" | "search" | "ica" | "skip"
  notes: string | null
}[] = [
  // ── HIGH VALUE: Trade show calendars & conference aggregators ──
  {
    name: "EventsEye",
    url: "https://www.eventseye.com",
    urlPattern: "eventseye\\.com",
    scrapeMode: "calendar",
    notes:
      "Trade show directory with structured tables. Browse by month or location. Events listed as: Event Name, Dates (MM/DD/YYYY), City, Country. Extract ALL upcoming events for US locations. Homepage has 'Trade shows by month' and 'Trade shows by location' links.",
  },
  {
    name: "10times.com",
    url: "https://10times.com",
    urlPattern: "10times\\.com",
    scrapeMode: "search",
    notes:
      "Event discovery platform. Search URL pattern: https://10times.com/{city}/upcoming. Results show event name, dates, venue, and category. Filter for 'Trade Show', 'Conference', 'Exhibition' types. Strong structured data with consistent formatting.",
  },
  {
    name: "allconferencealert.net",
    url: "https://allconferencealert.net/usa.php",
    urlPattern: "allconferencealert\\.net",
    scrapeMode: "search",
    notes:
      "Conference aggregator. Browse by topic or city. Listing pages show: Conference name, dates, venue, city, organizer. Has dedicated US page at /usa.php. Each conference has a detail page with more info.",
  },
  {
    name: "Eventbrite",
    url: "https://www.eventbrite.com",
    urlPattern: "eventbrite\\.com",
    scrapeMode: "search",
    notes:
      "Event ticketing platform. Search URL pattern: https://www.eventbrite.com/d/{state}--{city}/meetings/ or /conferences/ or /trade-shows/. Results are structured cards: event name, date, venue, price. Filter by 'Conferences', 'Trade Show', or 'Business' format. Focus on professional/business events only.",
  },
  {
    name: "TSNN - Trade Show News Network",
    url: "https://www.tsnn.com",
    urlPattern: "tsnn\\.com",
    scrapeMode: "calendar",
    notes:
      "Trade show industry news site with a trade show directory/calendar. Look for 'Trade Show Calendar' or 'TSNN Top 250' sections. Events listed with name, dates, venue. Part of Informa Connect.",
  },
  {
    name: "BizTradeShows.com",
    url: "https://www.biztradeshows.com",
    urlPattern: "biztradeshows\\.com",
    scrapeMode: "calendar",
    notes:
      "Trade show directory. Browse by industry or location. Events listed with name, dates, venue, organizer. Structured listing pages.",
  },
  {
    name: "tradeshowz.com",
    url: "https://www.tradeshowz.com",
    urlPattern: "tradeshowz\\.com",
    scrapeMode: "calendar",
    notes:
      "Trade show listings directory. Browse by date or location. Events have name, dates, venue, and industry category.",
  },
  {
    name: "internationalconferencealerts.com",
    url: "https://www.internationalconferencealerts.com",
    urlPattern: "internationalconferencealerts\\.com",
    scrapeMode: "ica",
    notes:
      "Conference alert site. Uses custom Puppeteer scraper (stealth + local Chrome). City-specific pages at /united-states/{slug}/{month}. Extracts event cards from listings, optional detail page scraping for email/venue.",
  },
  {
    name: "10times.com/venues",
    url: "https://10times.com/venues",
    urlPattern: "10times\\.com/venues",
    scrapeMode: "directory",
    notes:
      "Venue directory on 10times.com. Lists venues with their upcoming events. Match by venue name or city from our Location list.",
  },
  {
    name: "conferencenext.com",
    url: "https://www.conferencenext.com",
    urlPattern: "conferencenext\\.com",
    scrapeMode: "directory",
    notes:
      "Conference listing directory. Browse by location or topic. Shows event name, dates, venue.",
  },
  {
    name: "eventsinamerica.com",
    url: "https://www.events-in-america.com",
    urlPattern: "eventsinamerica\\.com",
    scrapeMode: "directory",
    notes:
      "Events directory for US events. Browse by state/city or event type. Shows event name, dates, location, description.",
  },
  {
    name: "tradefest.io",
    url: "https://tradefest.io",
    urlPattern: "tradefest\\.io",
    scrapeMode: "directory",
    notes:
      "Trade show and festival directory. Browse by industry or location. Shows event name, dates, venue.",
  },
  {
    name: "tradeshowhandbook.com",
    url: "https://www.tradeshowhandbook.com",
    urlPattern: "tradeshowhandbook\\.com",
    scrapeMode: "directory",
    notes:
      "Trade show resource directory. Lists upcoming trade shows with name, dates, venue, industry.",
  },
  {
    name: "All Conferences.Com",
    url: "https://allconferencealert.net/usa.php",
    urlPattern: "allconferences\\.com",
    scrapeMode: "search",
    notes:
      "Conference listing site. Search by location or topic. Has city-specific pages. Shows conference name, dates, venue, organizer.",
  },
  {
    name: "Showsbee - Event Research",
    url: "https://www.showsbee.com",
    urlPattern: "showsbee\\.com",
    scrapeMode: "directory",
    notes:
      "Event research and listing site. Browse by industry or location. Shows event name, dates, venue.",
  },

  // ── MEDIUM VALUE: Industry-specific directories ──
  {
    name: "Exhibit City News",
    url: "https://www.exhibitcitynews.com",
    urlPattern: "exhibitcitynews\\.com",
    scrapeMode: "directory",
    notes:
      "Exhibition industry news with event listings. Look for event calendar or trade show sections.",
  },
  {
    name: "FAIR Guide",
    url: "https://www.faiguide.com",
    urlPattern: "faiguide\\.com",
    scrapeMode: "directory",
    notes:
      "Fair and exhibition guide. Browse by industry or location. Shows event name, dates, venue.",
  },
  {
    name: "Fairs and Expos",
    url: "https://www.fairsandexpos.com",
    urlPattern: "fairsandexpos\\.com",
    scrapeMode: "directory",
    notes:
      "Fairs and expos directory. Browse by type or location. Shows event name, dates, venue.",
  },
  {
    name: "Black Meetings And Tourism",
    url: "https://www.blackmeetingsandtourism.com",
    urlPattern: "blackmeetingsandtourism\\.com",
    scrapeMode: "directory",
    notes:
      "Meetings and tourism industry publication with event listings. Focus on African American meetings and events.",
  },
  {
    name: "Sports Events Magazine",
    url: "https://www.sportseventsmagazine.com",
    urlPattern: "sportseventsmagazine\\.com",
    scrapeMode: "directory",
    notes:
      "Sports events industry publication. Look for event calendar or sports trade show listings.",
  },

  // ── ASSOCIATION SITES: Event calendars from industry associations ──
  {
    name: "IAEE",
    url: "https://www.iaee.org",
    urlPattern: "iaee\\.org",
    scrapeMode: "directory",
    notes:
      "International Association of Exhibitions and Events. Has event calendar for industry events and annual expo.",
  },
  {
    name: "InfoComm / AVIXA",
    url: "https://www.avixa.org",
    urlPattern: "avixa\\.org|infocomm\\.org",
    scrapeMode: "directory",
    notes:
      "AV/visual communications association. Has event calendar with trade shows and conferences.",
  },
  {
    name: "SGMP - Society of Gov Meeting Pros",
    url: "https://www.sgmp.org",
    urlPattern: "sgmp\\.org",
    scrapeMode: "directory",
    notes:
      "Society of Government Meeting Professionals. Has event calendar for government meetings industry.",
  },
  {
    name: "ASAE - Association Leadership",
    url: "https://www.asaecenter.org",
    urlPattern: "asaecenter\\.org|asae\\.org",
    scrapeMode: "directory",
    notes:
      "American Society of Association Executives. Has event calendar for association management events.",
  },
  {
    name: "Mid-Atlantic Society of Association Executives",
    url: "https://www.masae.org",
    urlPattern: "masae\\.org",
    scrapeMode: "directory",
    notes:
      "Regional association executives group. Has event calendar for mid-Atlantic region.",
  },
  {
    name: "Society of Gov Meeting Profs, National Capital Chapter",
    url: "https://www.sgmpncc.org",
    urlPattern: "sgmpncc\\.org",
    scrapeMode: "directory",
    notes: "SGMP National Capital Chapter. DC-area government meetings events.",
  },

  // ── PUBLICATION SITES: Industry news with event listings ──
  {
    name: "Projection, Lights and Staging News",
    url: "https://www.plsn.com",
    urlPattern: "plsn\\.com",
    scrapeMode: "directory",
    notes:
      "AV/staging industry publication. Has trade show calendar for events in the AV/live events space.",
  },
  {
    name: "Mobile Marketer",
    url: "https://www.mobilemarketer.com",
    urlPattern: "mobilemarketer\\.com",
    scrapeMode: "directory",
    notes:
      "Mobile marketing industry publication. Has event calendar for mobile/marketing conferences.",
  },
  {
    name: "Tradeshowbiz.com",
    url: "https://www.tradeshowbiz.com",
    urlPattern: "tradeshowbiz\\.com",
    scrapeMode: "directory",
    notes:
      "Trade show business resource. Lists trade shows with name, dates, venue, industry.",
  },

  // ── REGIONAL / LOCAL SITES ──
  {
    name: "Visit Baltimore",
    url: "https://www.baltimore.org",
    urlPattern: "baltimore\\.org",
    scrapeMode: "calendar",
    notes:
      "Baltimore tourism site. Has convention/event calendar. Match events at Baltimore venues from our Location list.",
  },
  {
    name: "PA State Assoc of County Fairs",
    url: "https://www.pacounties.org/fairs",
    urlPattern: "pacounties\\.org",
    scrapeMode: "directory",
    notes:
      "Pennsylvania county fairs listing. Shows fair name, dates, location.",
  },
  {
    name: "NARMS: Allied Associations",
    url: "https://www.narms.org",
    urlPattern: "narms\\.org",
    scrapeMode: "directory",
    notes:
      "National Association of Restaurant Marketing Suppliers. Has event calendar for restaurant industry.",
  },

  // ── SKIP: Supplier directories, job sites, non-event sources ──
  {
    name: "ConventionPlanit.com",
    url: "https://www.conventionplanit.com",
    urlPattern: "conventionplanit\\.com",
    scrapeMode: "skip",
    notes:
      "Venue/supplier directory, NOT an event listing site. Lists convention centers and service providers. Skip for event extraction.",
  },
  {
    name: "clocate.com",
    url: "https://www.clocate.com",
    urlPattern: "clocate\\.com",
    scrapeMode: "skip",
    notes:
      "Venue/convention center directory. Lists venues, not events. Skip for event extraction.",
  },
  {
    name: "Eventcareers.com",
    url: "https://www.eventcareers.com",
    urlPattern: "eventcareers\\.com",
    scrapeMode: "skip",
    notes:
      "Job board for event industry careers. Not an event listing site. Skip.",
  },
  {
    name: "JobsAV",
    url: "https://www.jobsav.com",
    urlPattern: "jobsav\\.com",
    scrapeMode: "skip",
    notes: "Job board for AV industry. Not an event listing site. Skip.",
  },
  {
    name: "InterDok",
    url: "https://www.interdok.com",
    urlPattern: "interdok\\.com",
    scrapeMode: "skip",
    notes:
      "Document/media distribution service. Not an event listing site. Skip.",
  },
  {
    name: "The Nat Cntr for Spectator Sports Security",
    url: "https://www.ncs4.com",
    urlPattern: "ncs4\\.com",
    scrapeMode: "skip",
    notes:
      "Research center for sports security. Has some events but primarily academic. Low priority.",
  },
  {
    name: "Physician Travel and Meeting Guide",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Reference only. No active URL. Skip.",
  },
  {
    name: "e3 Washington DC Hotels",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Google Sheets reference. No active URL. Skip.",
  },
  {
    name: "Visit Baltimore Partner Network - login",
    url: "https://www.baltimore.org/partner",
    urlPattern: null,
    scrapeMode: "skip",
    notes:
      "Login-protected partner portal. Cannot scrape without authentication. Skip.",
  },
  {
    name: "Meeting Source",
    url: "https://www.meetingsource.com",
    urlPattern: "meetingsource\\.com",
    scrapeMode: "skip",
    notes:
      "Meeting planning resource directory. Primarily supplier listings, not event listings. Low value.",
  },
  {
    name: "Cybersecurity Events 2025 - 2026",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Descriptive name from spreadsheet. No URL. Low value.",
  },
  {
    name: "Associations Directory in PA",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Reference only. No URL. Skip.",
  },
  {
    name: "Assoc for Convention Operations Management",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Reference only. No URL. Skip.",
  },
  {
    name: "Collegiate Conference & Event Directors",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Reference only. No URL. Skip.",
  },
  {
    name: "Embassy list",
    url: null,
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Reference only. No URL. Skip.",
  },
  {
    name: "Conferences locate",
    url: "https://www.clocate.com",
    urlPattern: null,
    scrapeMode: "skip",
    notes: "Duplicate of clocate.com. Already covered. Skip.",
  },
  {
    name: "Events in America",
    url: "https://www.events-in-america.com",
    urlPattern: null,
    scrapeMode: "skip",
    notes:
      "Duplicate of eventsinamerica.com entry above. Already covered. Skip.",
  },
  {
    name: "Association Directory - Trade Association List",
    url: "https://www.asaenet.org",
    urlPattern: "asaenet\\.org",
    scrapeMode: "skip",
    notes: "Trade association directory. Lists associations, not events. Skip.",
  },
]

// ─── Seed functions ──────────────────────────────────────────────────────────

async function seedOriginalLocations() {
  console.log("\n── Seeding original national locations ──")
  let created = 0
  for (const loc of DEFAULT_LOCATIONS) {
    const existing = await prisma.location.findFirst({
      where: { name: loc.name },
    })
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
    created++
    console.log(
      `  created: ${loc.name} (${EVENT_TYPE_KEYWORDS.length} search terms)`
    )
  }
  console.log(`  → ${created} new locations created`)
}

async function seedVenueMasterList() {
  console.log("\n── Seeding venue master list (70 rows) ──")
  let created = 0
  let skipped = 0
  for (const venue of VENUE_MASTER_LIST) {
    const existing = await prisma.location.findFirst({
      where: { name: venue.name },
    })
    if (existing) {
      skipped++
      continue
    }
    await prisma.location.create({
      data: {
        name: venue.name,
        shortName: venue.shortName,
        city: venue.city,
        state: venue.state,
        address: venue.address,
      },
    })
    created++
  }
  console.log(`  → ${created} new, ${skipped} skipped (already exist)`)
}

async function seedSearchTemplates() {
  console.log("\n── Seeding search templates ──")
  const existing = await prisma.searchTemplate.count()
  if (existing > 0) {
    console.log(`  skip: ${existing} templates already exist`)
    return
  }
  // Dedupe by template text
  const seen = new Set<string>()
  const unique = SEARCH_TEMPLATES.filter((t) => {
    const key = t.template.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  await prisma.searchTemplate.createMany({
    data: unique.map((t) => ({ template: t.template.trim() })),
  })
  console.log(
    `  → ${unique.length} templates created (${SEARCH_TEMPLATES.length - unique.length} duplicates removed)`
  )
}

async function seedSourceSites() {
  console.log("\n── Seeding source sites with scraping profiles ──")
  const existing = await prisma.sourceSite.count()
  if (existing > 0) {
    console.log(`  skip: ${existing} source sites already exist`)
    return
  }
  // Dedupe by normalized name
  const seen = new Set<string>()
  const unique = SOURCE_SITES.filter((s) => {
    const key = s.name.trim().toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  await prisma.sourceSite.createMany({
    data: unique.map((s) => ({
      name: s.name.trim(),
      url: s.url,
      urlPattern: s.urlPattern,
      scrapeMode: s.scrapeMode,
      notes: s.notes,
    })),
  })
  console.log(
    `  → ${unique.length} source sites created (${SOURCE_SITES.length - unique.length} duplicates removed)`
  )
  const byMode = unique.reduce(
    (acc, s) => {
      acc[s.scrapeMode] = (acc[s.scrapeMode] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )
  console.log(`  → scrapeMode breakdown:`, byMode)

  // Create SourceSiteConfig for ICA (custom puppeteer scraper)
  const ica = await prisma.sourceSite.findFirst({
    where: { name: "internationalconferencealerts.com" },
  })
  if (ica) {
    const existingCfg = await prisma.sourceSiteConfig.findUnique({
      where: { sourceSiteId: ica.id },
    })
    if (!existingCfg) {
      await prisma.sourceSiteConfig.create({
        data: {
          sourceSiteId: ica.id,
          listingUrlTemplate:
            "https://internationalconferencealerts.com/united-states/{slug}/{MONTH}",
          selectorEventName: "h3",
          aiFallback: true,
          maxPages: 3,
        },
      })
      console.log(`  → SourceSiteConfig created for ICA`)
    }
  }
}

// ─── Ingest Config (defaults for scrapers) ─────────────────────────────────

const INGEST_CONFIGS = [
  { scraper: "ica", maxMonths: 6, maxPages: 3, maxLocations: 0, active: true },
  { scraper: "cn",  maxMonths: 6, maxPages: 3, maxLocations: 0, active: true },
  { scraper: "aca", maxMonths: 6, maxPages: 5, maxLocations: 0, active: true },
  { scraper: "tf",  maxMonths: 6, maxPages: 5, maxLocations: 0, active: true },
  { scraper: "showsbee", maxMonths: 6, maxPages: 3, maxLocations: 0, active: true },
  { scraper: "eventseye", maxMonths: 6, maxPages: 3, maxLocations: 0, active: true },
]

async function seedIngestConfigs() {
  console.log("\n── Seeding ingest configs ──")
  for (const cfg of INGEST_CONFIGS) {
    await prisma.ingestConfig.upsert({
      where: { scraper: cfg.scraper },
      update: {},
      create: cfg,
    })
  }
  console.log(`  → ${INGEST_CONFIGS.length} scraper configs seeded`)
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Seeding database ===")

  await seedOriginalLocations()
  await seedVenueMasterList()
  await seedSearchTemplates()
  await seedSourceSites()
  await seedIngestConfigs()

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
