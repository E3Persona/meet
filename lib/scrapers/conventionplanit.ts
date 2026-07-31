import * as cheerio from "cheerio"
import { normalizeState } from "../stateNormalize"

const BASE = "https://www.conventionplanit.com"
const LISTING_URL = `${BASE}/conference_center_search2_nopop.php`
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export interface ConventionPlanitVenue {
  facilityId: string
  name: string
  city: string
  state: string
  country: string
  sqFt: string | null
  rooms: number | null
  detailUrl: string
}

export interface ConventionPlanitDetail {
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string | null
  rooms: number | null
  meetingSqFt: string | null
  contactName: string | null
  contactTitle: string | null
  email: string | null
  phone: string | null
  fax: string | null
  websiteUrl: string | null
  logoUrl: string | null
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

export async function scrapeListing(): Promise<ConventionPlanitVenue[]> {
  const html = await fetchPage(LISTING_URL)
  const $ = cheerio.load(html)
  const venues: ConventionPlanitVenue[] = []
  const seen = new Set<string>()

  $('div[align="left"]').each((_, el) => {
    const link = $(el).find("a").first()
    const href = link.attr("href") ?? ""
    const name = link.text().trim()
    if (!name || !href) return

    const facilityIdMatch = href.match(/facilitie_id=(\d+)/)
    if (!facilityIdMatch) return
    const facilityId = facilityIdMatch[1]
    if (seen.has(facilityId)) return
    seen.add(facilityId)

    const fullText = $(el).text()
    const lines = fullText.split("\n").map((l) => l.trim()).filter(Boolean)

    let locationLine = ""
    let sqFt: string | null = null
    let rooms: number | null = null

    for (const line of lines) {
      if (line.includes("Sq Ft")) {
        const sqMatch = line.match(/([\d,]+)\s*Sq\s*Ft/i)
        if (sqMatch) sqFt = sqMatch[1]
        const roomMatch = line.match(/([\d,]+)\s*Rooms/i)
        if (roomMatch) rooms = parseInt(roomMatch[1].replace(/,/g, ""), 10)
      } else if (line.includes(",") && (line.includes("USA") || line.includes("-"))) {
        locationLine = line
      }
    }

    if (!locationLine) {
      const brText = $(el).html() ?? ""
      const brParts = brText.split("<br>").map((s) => cheerio.load(`<div>${s}</div>`).text().trim()).filter(Boolean)
      for (const part of brParts) {
        if (part.includes(",") && (part.includes("USA") || part.includes("-") || part.includes("n/a"))) {
          locationLine = part
          break
        }
      }
    }

    let city = ""
    let state = ""
    let country = "USA"

    if (locationLine) {
      const locParts = locationLine.split("-").map((s) => s.trim())
      if (locParts.length >= 2) {
        const cityState = locParts[0].trim()
        const csParts = cityState.split(",").map((s) => s.trim())
        city = csParts[0] ?? ""
        state = csParts[1] ?? ""
        country = locParts[locParts.length - 1].trim()
      } else {
        const csParts = locationLine.split(",").map((s) => s.trim())
        city = csParts[0] ?? ""
        if (csParts.length >= 2) {
          const rest = csParts.slice(1).join(" ")
          if (rest.includes("-")) {
            const sp = rest.split("-").map((s) => s.trim())
            state = sp[0]
            country = sp[1] ?? "USA"
          } else {
            state = rest
          }
        }
      }
    }

    const detailUrl = href.startsWith("http") ? href : `${BASE}/${href}`

    venues.push({
      facilityId,
      name,
      city,
      state,
      country,
      sqFt,
      rooms,
      detailUrl,
    })
  })

  return venues
}

function extractText($: cheerio.CheerioAPI, html: string): string {
  return cheerio.load(`<div>${html}</div>`).text().replace(/\s+/g, " ").trim()
}

export async function scrapeDetail(facilityId: string, detailUrl: string): Promise<ConventionPlanitDetail> {
  let html: string
  try {
    html = await fetchPage(detailUrl)
  } catch (err) {
    console.warn(`[cp] Failed to fetch detail for ${detailUrl}:`, err)
    const jina = await import("../providers/scrape/jina").then((m) => m.createJinaProvider())
    const result = await jina.scrape(detailUrl, { timeout: 30000 })
    if (!result.markdown) throw err
    return extractDetailFromMarkdown(result.markdown)
  }

  const $ = cheerio.load(html)

  let address: string | null = null
  let detailCity: string | null = null
  let detailState: string | null = null
  let zip: string | null = null
  let country: string | null = null
  let rooms: number | null = null
  let meetingSqFt: string | null = null
  let contactName: string | null = null
  let contactTitle: string | null = null
  let email: string | null = null
  let phone: string | null = null
  let fax: string | null = null
  let websiteUrl: string | null = null

  const addrTd = $("td").filter((_, el) => {
    const text = $(el).text()
    return text.includes("Number of Rooms:") || (text.includes("Conference Center Drive") || text.includes("Leesburg"))
  }).first()
  const addrParent = addrTd.closest("td")

  const contactTd = $('td:contains("Sales Contact:")').first()
  if (contactTd.length) {
    const contactHtml = contactTd.html() ?? ""
    const contactText = extractText($, contactHtml)

    const nameMatch = contactText.match(/Sales Contact:\s*(.+?)(?:Contact Title:|$)/i)
    if (nameMatch) contactName = nameMatch[1].trim()

    const titleMatch = contactText.match(/Contact Title:\s*(.+)/i)
    if (titleMatch) contactTitle = titleMatch[1].trim()

    const emailMatch = contactText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    if (emailMatch) email = emailMatch[0]

    const phoneMatch = contactHtml.match(/<b><a onclick="getPhone\(/i)
    if (phoneMatch) phone = "(click to view on site)"

    const faxMatch = contactText.match(/Fax:\s*([\d-]+)/i)
    if (faxMatch) fax = faxMatch[1].trim()

    const websiteMatch = contactHtml.match(/View Website[^<]*<\/a>/)
    if (!websiteMatch) {
      const webLink = $('a:contains("View Website")').first()
      if (webLink.length) {
        const onclick = webLink.attr("onclick") ?? ""
        const linkMatch = onclick.match(/['"]conference_center_link\.php\?([^'"]+)['"]/)
        if (linkMatch) {
          websiteUrl = `${BASE}/conference_center_link.php?${linkMatch[1]}`
        }
      }
    }
  }

  const addrTexts: string[] = []
  $('font[size="-1"][face="Arial"]').each((_, el) => {
    const text = $(el).text()
    if (text.includes("Conference Center") && text.includes("Drive")) {
      addrTexts.push(text)
    }
  })
  const fullAddrText = addrTexts.join(" ") || $('font[size="-1"][face="Arial"]').first().text()

  const roomMatch = fullAddrText.match(/Number of Rooms:\s*(\d[\d,]*)/i)
  if (roomMatch) rooms = parseInt(roomMatch[1].replace(/,/g, ""), 10)

  const spaceMatch = fullAddrText.match(/Meeting Space:.*?(\d[\d,]*)\s*Sq\.?\s*Ft/i)
  if (spaceMatch) meetingSqFt = spaceMatch[1]

  const lines = fullAddrText.split("\n").map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (line.match(/^\d+\s/) && (line.includes("Drive") || line.includes("Street") || line.includes("Ave") || line.includes("Road") || line.includes("Boulevard") || line.includes("Lane") || line.includes("Way") || line.includes("Circle"))) {
      if (!address) address = line
    }
    const csMatch = line.match(/^([A-Za-z\s.]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/)
    if (csMatch) {
      detailCity = csMatch[1].trim()
      detailState = csMatch[2]
      zip = csMatch[3]
    }
    if (line === "USA" || line === "Canada" || line === "Mexico" || line === "United Kingdom" || line.match(/^[A-Z][a-z]+$/)) {
      if (!country || country === "n/a") country = line
    }
  }

  const countryMatch = fullAddrText.match(/(USA|Canada|Mexico|France|Germany|Italy|Spain|Netherlands|Belgium|Hungary|United Kingdom|Australia|Japan|China|Brazil)/i)
  if (countryMatch && !country) country = countryMatch[1]

  return {
    address,
    city: detailCity,
    state: detailState,
    zip,
    country,
    rooms,
    meetingSqFt,
    contactName,
    contactTitle,
    email,
    phone,
    fax,
    websiteUrl,
    logoUrl: null,
  }
}

function extractDetailFromMarkdown(md: string): ConventionPlanitDetail {
  const emailMatch = md.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  const phoneMatch = md.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
  const roomsMatch = md.match(/Number of Rooms:?\s*(\d[\d,]*)/i)
  const spaceMatch = md.match(/Meeting Space:.*?(\d[\d,]*)\s*Sq/i)
  const nameMatch = md.match(/Sales Contact:\s*(.+)/i)

  return {
    address: null,
    city: null,
    state: null,
    zip: null,
    country: null,
    rooms: roomsMatch ? parseInt(roomsMatch[1].replace(/,/g, ""), 10) : null,
    meetingSqFt: spaceMatch ? spaceMatch[1] : null,
    contactName: nameMatch ? nameMatch[1].trim() : null,
    contactTitle: null,
    email: emailMatch ? emailMatch[0] : null,
    phone: phoneMatch ? phoneMatch[0].trim() : null,
    fax: null,
    websiteUrl: null,
    logoUrl: null,
  }
}

export interface ConventionPlanitResult {
  venue: ConventionPlanitVenue
  detail: ConventionPlanitDetail
}

export async function scrapeConventionPlanit(
  activeCities: { city: string | null; state: string | null }[]
): Promise<ConventionPlanitResult[]> {
  if (activeCities.length === 0) {
    console.log("[cp] No active city locations found, skipping")
    return []
  }

  const cityNames = new Set(activeCities.map((l) => (l.city ?? "").toLowerCase()))
  const stateNames = new Set(activeCities.map((l) => normalizeState(l.state) ?? (l.state ?? "").toLowerCase()))

  console.log(`[cp] Scraping listing...`)
  const allVenues = await scrapeListing()
  console.log(`[cp] ${allVenues.length} venues found on listing`)

  const matched = allVenues.filter((v) => {
    const vCity = v.city.toLowerCase()
    const vState = normalizeState(v.state) ?? v.state.toLowerCase()
    return cityNames.has(vCity) && stateNames.has(vState)
  })

  console.log(`[cp] ${matched.length} venues match active locations`)

  const results: ConventionPlanitResult[] = []
  for (const venue of matched) {
    console.log(`[cp] Fetching detail: ${venue.name} (${venue.city}, ${venue.state})`)
    try {
      const detail = await scrapeDetail(venue.facilityId, venue.detailUrl)
      results.push({ venue, detail })
    } catch (err) {
      console.error(`[cp] Detail failed for ${venue.name}:`, err)
    }
  }

  return results
}
