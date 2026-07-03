// scrapers/ecn.ts
import * as cheerio from "cheerio"
import { createJinaProvider } from "../providers/scrape/jina"

const ECN_BASE = "https://thetradeshowcalendar.com/ecn2.2024"
const LISTING_URL = `${ECN_BASE}/index.php`

// ---------- Target region config (mirrors ICA_CITY_SLUGS pattern) ----------

export const ECN_TARGET_REGIONS: Record<
  string,
  { city: string; state: string }
> = {
  philadelphia: { city: "Philadelphia", state: "PA" },
  "washington-dc": { city: "Washington", state: "DC" },
  baltimore: { city: "Baltimore", state: "MD" },
}

// Loose regional match so nearby satellite towns count as "in scope"
const REGION_ALIASES: Record<string, string> = {
  "national harbor": "washington-dc",
  bethesda: "washington-dc",
  "upper marlboro": "washington-dc",
  arlington: "washington-dc",
  chester: "philadelphia",
  oaks: "philadelphia",
  "valley forge": "philadelphia",
  wilmington: "philadelphia",
  "ellicott city": "baltimore",
  "west friendship": "baltimore",
}

function classifyRegion(city: string, state: string | null): string | null {
  const c = city.toLowerCase().trim()
  const s = (state ?? "").toLowerCase().trim()

  for (const [slug, meta] of Object.entries(ECN_TARGET_REGIONS)) {
    if (
      c === meta.city.toLowerCase() &&
      (!s || s === meta.state.toLowerCase())
    ) {
      return slug
    }
  }
  if (REGION_ALIASES[c]) return REGION_ALIASES[c]
  return null
}

// ---------- Types ----------

export interface ECNContact {
  organizerName: string | null
  organizerOrg: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  organizerLinkedIn: null
  contactSource: "official-site-home" | "official-site-contact-page" | null
}

export interface ECNEvent {
  eventName: string
  eventDateStart: string
  eventDateEnd: string | null
  officialWebsite: string
  venueName: string | null
  venueCity: string
  venueState: string | null
  venueCountry: string
  attendees: number | null
  exhibitors: number | null
  regionSlug: string | null
  contacts: ECNContact[]
  sourceSite: "exhibitcitynews.com"
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (base: number) => base + Math.random() * base * 0.5

// ---------- Phase 1: Puppeteer form submission + pagination ----------

async function submitCountrySearch(
  page: any,
  country: string
): Promise<boolean> {
  await page.goto(LISTING_URL, { waitUntil: "networkidle2", timeout: 30000 })
  await wait(1500)

  // Runtime introspection: find the <select> whose options include our target
  // country text, rather than trusting a guessed `name` attribute.
  const picked = await page.evaluate((targetCountry: string) => {
    const selects = Array.from(document.querySelectorAll("select"))
    for (const sel of selects) {
      const opts = Array.from(sel.options).map((o) => o.text.trim())
      if (opts.includes(targetCountry)) {
        sel.value = Array.from(sel.options).find(
          (o) => o.text.trim() === targetCountry
        )!.value
        return { name: sel.getAttribute("name"), id: sel.id }
      }
    }
    return null
  }, country)

  if (!picked) {
    console.warn(
      `[ECN] Could not locate a country <select> containing "${country}"`
    )
    return false
  }
  console.log(`[ECN] Set country select (name="${picked.name}") to ${country}`)

  // Submit the enclosing form (tagForm), which POSTs to setcookie.php and
  // establishes the session the results pages rely on.
  const submitted = await page.evaluate(() => {
    const form = document.querySelector<HTMLFormElement>(
      "#tagForm, form[name='tagForm']"
    )
    if (!form) return false
    form.submit()
    return true
  })

  if (!submitted) {
    console.warn(`[ECN] Could not find #tagForm to submit`)
    return false
  }

  try {
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 })
  } catch {
    // some PHP form posts redirect via meta-refresh rather than a clean nav;
    // give it a beat and re-check content instead of hard-failing
    await wait(3000)
  }

  return true
}

function parseTotalCount(html: string): number | null {
  const m = html.match(/out of\s+([\d,]+)\s+exhibitions/i)
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null
}

function parseListingRows(
  $: cheerio.CheerioAPI
): Omit<ECNEvent, "contacts" | "regionSlug" | "sourceSite">[] {
  const events: Omit<ECNEvent, "contacts" | "regionSlug" | "sourceSite">[] = []

  $("tr.row").each((_, el) => {
    const $row = $(el)

    const $nameLink = $row.find("td.r-Name a").first()
    const eventName = $nameLink.text().trim()
    const officialWebsite = $nameLink.attr("href")?.trim() ?? ""
    if (!eventName || !officialWebsite) return

    const dateHtml = $row.find("td.r-Dates .r-content").html() ?? ""
    const dateParts = dateHtml
      .split(/<br\s*\/?>/i)
      .map((s) => s.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)
    const eventDateStart = dateParts[0] ?? ""
    const eventDateEnd = dateParts[1] ?? null

    const venLocHtml = $row.find("td.r-VenLoc .r-content").html() ?? ""
    const venLocLines = venLocHtml
      .split(/<br\s*\/?>/i)
      .map((s) => s.replace(/<[^>]+>/g, "").trim())
      .filter(Boolean)

    // Either [venue, "City, State, Country"] or just ["City, State, Country"]
    let venueName: string | null = null
    let locationLine = ""
    if (venLocLines.length >= 2) {
      venueName = venLocLines[0]
      locationLine = venLocLines[venLocLines.length - 1]
    } else if (venLocLines.length === 1) {
      locationLine = venLocLines[0]
    }

    const locParts = locationLine.split(",").map((s) => s.trim())
    let venueCity = ""
    let venueState: string | null = null
    let venueCountry = "United States"

    if (locParts.length === 3) {
      // "City, ST, Country"
      ;[venueCity, venueState, venueCountry] = locParts
    } else if (locParts.length === 2) {
      // could be "City, ST" (US, country implied) or "City, Country" (intl)
      venueCity = locParts[0]
      if (/^[A-Z]{2}$/.test(locParts[1])) {
        venueState = locParts[1]
      } else {
        venueCountry = locParts[1]
      }
    } else if (locParts.length === 1) {
      venueCity = locParts[0]
    }

    const attExhText = $row.find("td.r-AttExh .r-content").text()
    const attMatch = attExhText.match(/Attendees:\s*([\d,]+)/i)
    const exhMatch = attExhText.match(/Exhibitors:\s*([\d,]+)/i)

    events.push({
      eventName,
      eventDateStart,
      eventDateEnd,
      officialWebsite,
      venueName,
      venueCity,
      venueState,
      venueCountry,
      attendees: attMatch ? parseInt(attMatch[1].replace(/,/g, ""), 10) : null,
      exhibitors: exhMatch ? parseInt(exhMatch[1].replace(/,/g, ""), 10) : null,
    })
  })

  return events
}

async function scrapeListing(
  page: any,
  options: { pageSize?: number; maxPages?: number }
): Promise<Omit<ECNEvent, "contacts" | "regionSlug" | "sourceSite">[]> {
  const pageSize = options.pageSize ?? 30
  const maxPages = options.maxPages ?? 200

  const all: Omit<ECNEvent, "contacts" | "regionSlug" | "sourceSite">[] = []
  const seenUrls = new Set<string>()

  let pos = 0
  let total = Infinity
  let pageCount = 0

  while (pos < total && pageCount < maxPages) {
    const url = `${LISTING_URL}?vShow=&vSort=&vPos=${pos}&vRpP=${pageSize}`
    console.log(`[ECN] Listing page: ${url}`)

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })
    await wait(jitter(800))

    const html: string = await page.content()
    const $ = cheerio.load(html)

    const foundTotal = parseTotalCount(html)
    if (foundTotal !== null) total = foundTotal

    const rows = parseListingRows($)
    if (rows.length === 0) break

    for (const row of rows) {
      if (seenUrls.has(row.officialWebsite)) continue
      seenUrls.add(row.officialWebsite)
      all.push(row)
    }

    pos += pageSize
    pageCount++
    await wait(jitter(1200))
  }

  return all
}

// ---------- Phase 2: organizer contact fallback via Jina ----------

function extractEmail(markdown: string): string | null {
  const m = markdown.match(/[\w.+-]+@[\w-]+\.[a-z.]{2,}/i)
  return m ? m[0] : null
}

function extractPhone(markdown: string): string | null {
  const m = markdown.match(
    /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  )
  return m ? m[0].trim() : null
}

// Looks for a line like "Contact: Jane Smith" or "Show Manager: Jane Smith"
function extractContactName(markdown: string): string | null {
  const m = markdown.match(
    /(?:Contact|Show Manager|Show Director|Sales Manager|Exhibit Sales)\s*:?\s*\n?([A-Z][a-zA-Z.'-]+\s+[A-Z][a-zA-Z.'-]+)/
  )
  return m ? m[1].trim() : null
}

// Pull the first markdown link that looks like a "contact us" page
function findContactPageUrl(markdown: string, baseUrl: string): string | null {
  const linkRegex = /\[([^\]]*)\]\((https?:\/\/[^\s)]+|\/[^\s)]+)\)/gi
  let match: RegExpExecArray | null
  while ((match = linkRegex.exec(markdown)) !== null) {
    const [, text, href] = match
    const combined = `${text} ${href}`.toLowerCase()
    if (combined.includes("contact")) {
      try {
        return new URL(href, baseUrl).toString()
      } catch {
        continue
      }
    }
  }
  return null
}

export async function scrapeOrganizerContact(
  officialWebsite: string
): Promise<ECNContact> {
  const jina = createJinaProvider()
  const empty: ECNContact = {
    organizerName: null,
    organizerOrg: null,
    organizerEmail: null,
    organizerPhone: null,
    organizerLinkedIn: null,
    contactSource: null,
  }

  // 1. Try the homepage first
  const homeResult = await jina.scrape(officialWebsite, { timeout: 20000 })
  if (homeResult.markdown) {
    const email = extractEmail(homeResult.markdown)
    const phone = extractPhone(homeResult.markdown)
    const name = extractContactName(homeResult.markdown)

    if (email || phone) {
      return {
        organizerName: name,
        organizerOrg: null,
        organizerEmail: email,
        organizerPhone: phone,
        organizerLinkedIn: null,
        contactSource: "official-site-home",
      }
    }

    // 2. Fall back to a discovered "contact us" page
    const contactUrl = findContactPageUrl(homeResult.markdown, officialWebsite)
    if (contactUrl) {
      await wait(jitter(1000))
      const contactResult = await jina.scrape(contactUrl, { timeout: 20000 })
      if (contactResult.markdown) {
        const cEmail = extractEmail(contactResult.markdown)
        const cPhone = extractPhone(contactResult.markdown)
        const cName = extractContactName(contactResult.markdown)
        if (cEmail || cPhone) {
          return {
            organizerName: cName,
            organizerOrg: null,
            organizerEmail: cEmail,
            organizerPhone: cPhone,
            organizerLinkedIn: null,
            contactSource: "official-site-contact-page",
          }
        }
      }
    }
  }

  console.warn(`[ECN]   ✗ no organizer contact found via ${officialWebsite}`)
  return empty
}

// ---------- Orchestration ----------

export async function scrapeECN(options?: {
  country?: string
  pageSize?: number
  maxPages?: number
  skipContacts?: boolean
  maxContactLookups?: number
}): Promise<ECNEvent[]> {
  const country = options?.country ?? "United States"
  const skipContacts = options?.skipContacts ?? false
  const maxContactLookups = options?.maxContactLookups ?? Infinity

  const { launch: launchBrowser } = await import("puppeteer-core")

  const browser = await launchBrowser({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  )

  let raw: Omit<ECNEvent, "contacts" | "regionSlug" | "sourceSite">[] = []

  try {
    const ok = await submitCountrySearch(page, country)
    if (!ok) {
      console.warn(
        `[ECN] Form submission failed — falling back to unfiltered global listing, will client-filter instead`
      )
    }
    raw = await scrapeListing(page, {
      pageSize: options?.pageSize,
      maxPages: options?.maxPages,
    })
  } finally {
    await browser.close()
  }

  // Client-side region filter (belt-and-suspenders even if the server-side
  // country filter worked correctly)
  const regionMatched = raw
    .map((ev) => ({
      ...ev,
      regionSlug: classifyRegion(ev.venueCity, ev.venueState),
    }))
    .filter((ev) => ev.regionSlug !== null)

  const results: ECNEvent[] = []
  let contactLookups = 0

  for (const ev of regionMatched) {
    let contacts: ECNContact[] = [
      {
        organizerName: null,
        organizerOrg: null,
        organizerEmail: null,
        organizerPhone: null,
        organizerLinkedIn: null,
        contactSource: null,
      },
    ]

    if (!skipContacts && contactLookups < maxContactLookups) {
      try {
        contacts = [await scrapeOrganizerContact(ev.officialWebsite)]
      } catch (err) {
        console.error(
          `[ECN] Contact lookup error for ${ev.officialWebsite}:`,
          err
        )
      }
      contactLookups++
      await wait(jitter(1200))
    }

    results.push({
      ...ev,
      contacts,
      sourceSite: "exhibitcitynews.com",
    })
  }

  results.sort(
    (a, b) =>
      new Date(a.eventDateStart).getTime() -
      new Date(b.eventDateStart).getTime()
  )

  return results
}
