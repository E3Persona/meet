import * as cheerio from "cheerio"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"

puppeteer.use(StealthPlugin())

const BASE = "https://internationalconferencealerts.com"

export const ICA_CITY_SLUGS: Record<string, { city: string; state: string }> = {
  philadelphia: { city: "Philadelphia", state: "PA" },
  "washington-dc": { city: "Washington DC", state: "DC" },
  baltimore: { city: "Baltimore", state: "MD" },
  "new-york": { city: "New York", state: "NY" },
  chicago: { city: "Chicago", state: "IL" },
  "los-angeles": { city: "Los Angeles", state: "CA" },
  "san-francisco": { city: "San Francisco", state: "CA" },
  "las-vegas": { city: "Las Vegas", state: "NV" },
  boston: { city: "Boston", state: "MA" },
  dallas: { city: "Dallas", state: "TX" },
  miami: { city: "Miami", state: "FL" },
  orlando: { city: "Orlando", state: "FL" },
  seattle: { city: "Seattle", state: "WA" },
  denver: { city: "Denver", state: "CO" },
  "san-diego": { city: "San Diego", state: "CA" },
  "san-antonio": { city: "San Antonio", state: "TX" },
  phoenix: { city: "Phoenix", state: "AZ" },
  atlanta: { city: "Atlanta", state: "GA" },
}

export function cityToIcaSlug(city: string, state: string): string | null {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  const c = norm(city)

  const direct: Record<string, string> = {
    philadelphia: "philadelphia",
    "washington dc": "washington-dc",
    baltimore: "baltimore",
    "new york": "new-york",
    chicago: "chicago",
    "los angeles": "los-angeles",
    "san francisco": "san-francisco",
    "las vegas": "las-vegas",
    boston: "boston",
    dallas: "dallas",
    miami: "miami",
    orlando: "orlando",
    seattle: "seattle",
    denver: "denver",
    "san diego": "san-diego",
    "san antonio": "san-antonio",
    phoenix: "phoenix",
    atlanta: "atlanta",
  }
  if (direct[c]) return direct[c]

  const regional: Record<string, string> = {
    "national harbor": "washington-dc",
    bethesda: "washington-dc",
    "upper marlboro": "washington-dc",
    chester: "philadelphia",
    oaks: "philadelphia",
    "valley forge": "philadelphia",
    wilmington: "philadelphia",
    "ellycott city": "baltimore",
    "west friendship": "baltimore",
    grapevine: "dallas",
    kissimmee: "orlando",
  }
  if (regional[c]) return regional[c]

  return null
}

export const ICA_MONTHS = [
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
]

export interface ICAContact {
  organizerName: string | null
  organizerOrg: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  organizerLinkedIn: null
}

export interface ICAEvent {
  eventName: string
  eventAcronym: string | null
  eventType: string | null
  eventTopic: string | null
  eventDateStart: string
  eventDateEnd: string | null
  eventUrl: string
  officialWebsite: string | null
  venueFullName: string | null
  venueAddress: string | null
  venueCity: string
  venueState: string | null
  venueCountry: string
  contacts: ICAContact[]
  registrationDeadline: string | null
  submissionDeadline: string | null
  description: string | null
  expectedAttendees: number | null
  sourceSite: "internationalconferencealerts.com"
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (baseMs: number) => baseMs + Math.random() * baseMs * 0.5

function decodeCFEmail(encoded: string): string {
  let email = ""
  const r = parseInt(encoded.slice(0, 2), 16)
  for (let n = 2; n < encoded.length; n += 2) {
    email += String.fromCharCode(parseInt(encoded.slice(n, n + 2), 16) ^ r)
  }
  return email
}

function extractAcronym(title: string): string | null {
  const match = title.match(/\(([A-Z0-9\-]{2,12})\)\s*$/)
  return match ? match[1] : null
}

function parseDates(dateText: string): { start: string; end: string | null } {
  const parts = dateText.split(" - ")
  return {
    start: parts[0]?.trim() || dateText,
    end: parts[1]?.trim() || null,
  }
}

function isCloudflareChallenge(html: string): boolean {
  const bodyText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  return (
    bodyText.includes("Just a moment") ||
    bodyText.includes("Enable JavaScript and cookies")
  )
}

function extractPhoneFromText(text: string): string | null {
  // Matches formats like (215) 555-1234, 215-555-1234, 215.555.1234, +1 215 555 1234
  const match = text.match(
    /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  )
  return match ? match[0].trim() : null
}

function findPhone(
  $: cheerio.CheerioAPI,
  $emailAnchor: ReturnType<cheerio.CheerioAPI> | null
): string | null {
  // 1. Most reliable: an actual tel: link anywhere on the page
  const $telAnchor = $('a[href^="tel:"]').first()
  if ($telAnchor.length) {
    const href = $telAnchor.attr("href") || ""
    const phone = href.replace("tel:", "").trim()
    if (phone) return phone
  }

  // 2. Fallback: look near the email anchor, same sibling-walk pattern
  //    used for org/name, in case phone is the next sibling
  if ($emailAnchor) {
    const $parent = $emailAnchor.parent()
    const siblings = $parent.children().toArray()
    const emailIdx = siblings.findIndex((el) => el === $emailAnchor.get(0))

    if (emailIdx >= 0 && emailIdx + 1 < siblings.length) {
      const nextText = $(siblings[emailIdx + 1])
        .text()
        .trim()
      const phoneMatch = extractPhoneFromText(nextText)
      if (phoneMatch) return phoneMatch
    }

    // 3. Last resort: scan the whole contact container's text for a phone-looking string
    const containerText = $parent.text()
    const phoneMatch = extractPhoneFromText(containerText)
    if (phoneMatch) return phoneMatch
  }

  return null
}

// ---------- Organizer/email extraction (fixed) ----------
// This site obfuscates emails as either:
//   1. <a href="mailto:...">
//   2. <a href="/cdn-cgi/l/email-protection#<hex>"> (Cloudflare redirect style — no mailto, no data-cfemail needed)
//   3. <span data-cfemail="<hex>"> (Cloudflare span style)
// Previously, email decoding checked (1) or (3), but the organizer name/org sibling-walk
// only checked (1) — so on pages using style (2), which is what this site actually renders,
// organizer name/org was silently always null. Both extractions now share one anchor lookup.
function findEmailAnchor(
  $: cheerio.CheerioAPI
): ReturnType<cheerio.CheerioAPI> | null {
  let $a = $('a[href^="mailto:"]').first()
  if ($a.length) return $a

  $a = $('a[href*="/cdn-cgi/l/email-protection"]').first()
  if ($a.length) return $a

  $a = $("[data-cfemail]").first()
  if ($a.length) return $a

  return null
}

function decodeEmailFromAnchor(
  $: cheerio.CheerioAPI,
  $a: ReturnType<cheerio.CheerioAPI>
): string | null {
  const href = $a.attr("href") ?? ""

  if (href.startsWith("mailto:")) {
    return href.replace("mailto:", "").trim()
  }

  const cfAttr = $a.attr("data-cfemail")
  if (cfAttr) return decodeCFEmail(cfAttr)

  const hashMatch = href.match(/email-protection#([a-f0-9]+)/i)
  if (hashMatch) return decodeCFEmail(hashMatch[1])

  return null
}

async function fetchListingPage(
  page: any,
  url: string
): Promise<{
  cards: {
    name: string
    url: string
    city: string
    country: string
    dateText: string
    eventType: string | null
    eventTopic: string | null
  }[]
  totalPages: number
}> {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })

  let html: string = await page.content()

  if (isCloudflareChallenge(html)) {
    console.log(`[ICA] CF challenge detected, waiting up to 45s...`)
    await wait(45000)
    html = await page.content()
    if (isCloudflareChallenge(html)) {
      console.warn(`[ICA] Still blocked by Cloudflare: ${url}`)
      return { cards: [], totalPages: 0 }
    }
    console.log(`[ICA] Challenge resolved`)
  }

  const $ = cheerio.load(html)
  const cards: {
    name: string
    url: string
    city: string
    country: string
    dateText: string
    eventType: string | null
    eventTopic: string | null
  }[] = []
  const seen = new Set<string>()

  $('a[href^="/event-"]').each((_, el) => {
    const $el = $(el)
    const href = $el.attr("href") || ""
    if (seen.has(href)) return
    seen.add(href)

    const badges = $el
      .find('span[data-slot="badge"]')
      .map((_, b) => $(b).text().trim())
      .get()
    const eventType = badges[0] || null
    const eventTopic = badges[1] || null

    const name = $el.find("h3").first().text().trim()

    const infoItems = $el
      .find("div.text-muted-foreground > div")
      .map((_, d) => $(d).text().trim())
      .get()
      .filter(Boolean)

    let dateText = ""
    let locationText = ""
    for (const item of infoItems) {
      if (/[A-Z][a-z]{2}\s\d{1,2}/.test(item)) {
        dateText = item
      } else if (item.includes(",")) {
        locationText = item
      }
    }

    const locationParts = locationText.split(",").map((s) => s.trim())
    const city = locationParts[0] || ""
    const country = locationParts.slice(1).join(",").trim() || "United States"

    if (!name || !dateText) return

    cards.push({
      name,
      url: `${BASE}${href}`,
      city,
      country,
      dateText,
      eventType,
      eventTopic,
    })
  })

  let totalPages = 1
  $('a[href*="?page="]').each((_, el) => {
    const href = $(el).attr("href") || ""
    const match = href.match(/[?&]page=(\d+)/)
    if (match) {
      const n = parseInt(match[1])
      if (n > totalPages) totalPages = n
    }
  })

  return { cards, totalPages }
}

interface DetailResult {
  officialWebsite: string | null
  venueFullName: string | null
  venueAddress: string | null
  venueCity: string | null
  venueState: string | null
  venuePostalCode: string | null
  venueCountry: string | null
  organizerName: string | null
  organizerOrg: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  description: string | null
  registrationDeadline: string | null
  submissionDeadline: string | null
}

async function scrapeDetailPage(
  page: any,
  url: string
): Promise<Partial<DetailResult>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 })
      break
    } catch {
      if (attempt < 2) await wait(3000)
      else throw new Error(`Failed to navigate to ${url}`)
    }
  }

  let html: string = await page.content()

  if (isCloudflareChallenge(html)) {
    console.log(`[ICA] CF challenge on detail, waiting up to 45s...`)
    await wait(45000)
    html = await page.content()
    if (isCloudflareChallenge(html)) {
      console.warn(`[ICA] Still blocked by Cloudflare: ${url}`)
      return {}
    }
    console.log(`[ICA] Challenge resolved`)
  }

  const $ = cheerio.load(html)

  // ---- Description from main content area ----
  let description: string | null = null
  const descEl = $("article, .event-description, [class*='description'], main, .content, #content, .event-body").first()
  if (descEl.length) {
    description = descEl.text().replace(/\s+/g, " ").trim() || null
  }
  if (!description) {
    description = $("body").clone()
      .find("script, style, nav, header, footer, .sidebar, .menu, .nav, .cookie, .modal, .popup, .ad, .advertisement, .social, .share, .related, .recommended")
      .remove().end().text().replace(/\s+/g, " ").trim() || null
  }
  console.log(`[ICA] Description extracted: ${description ? `${description.length} chars` : "none"}`)

  // ---- Official website: first external link that isn't ICA/social/CF internals ----
  let officialWebsite: string | null = null
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || ""
    if (
      href.startsWith("http") &&
      !href.includes("internationalconferencealerts.com") &&
      !href.includes("cdn-cgi") &&
      !href.includes("googletagmanager") &&
      !href.includes("linkedin.com") &&
      !href.includes("facebook.com") &&
      !href.includes("twitter.com") &&
      !href.includes("x.com") &&
      !href.includes("youtube.com") &&
      !href.includes("instagram.com")
    ) {
      officialWebsite = href
      return false
    }
  })

  // ---- Organizer name / org / email (fixed) ----
  const $emailAnchor = findEmailAnchor($)
  const organizerEmail = $emailAnchor
    ? decodeEmailFromAnchor($, $emailAnchor)
    : null

  const organizerPhone = findPhone($, $emailAnchor)

  let organizerName: string | null = null
  let organizerOrg: string | null = null

  if ($emailAnchor) {
    const $parent = $emailAnchor.parent()
    const siblings = $parent.children().toArray()
    const emailIdx = siblings.findIndex((el) => el === $emailAnchor.get(0))

    if (emailIdx >= 2) {
      organizerOrg =
        $(siblings[emailIdx - 2])
          .text()
          .trim() || null
      organizerName =
        $(siblings[emailIdx - 1])
          .text()
          .trim() || null
    } else if (emailIdx === 1) {
      organizerName =
        $(siblings[emailIdx - 1])
          .text()
          .trim() || null
    }
  }

  // ---- Organizer name fallback: lucide-user icon pattern ----
  // Some pages render the name in: <div class="flex...text-muted-foreground"><svg class="lucide-user">...<span>Name</span></div>
  // separate from the email anchor, so the sibling-walk above misses it.
  if (!organizerName) {
    const $userIcon = $(`svg.lucide-user:first`)
    if ($userIcon.length) {
      const $container = $userIcon.closest(
        `div.flex, div[class*="flex"], div[class*="items-center"]`
      )
      if ($container.length) {
        const nameViaSvg = $container.find("span").first().text().trim()
        if (nameViaSvg) organizerName = nameViaSvg
      }
    }
  }

  if (!organizerName && !organizerOrg && !organizerEmail) {
    console.warn(`[ICA]   ✗ no organizer found: ${url}`)
  }

  // ---- Venue ----
  let venueFullName: string | null = null
  let venueAddress: string | null = null
  let venueCity: string | null = null
  let venueState: string | null = null
  let venuePostalCode: string | null = null
  let venueCountry: string | null = null

  $("div, section, p").each((_, el) => {
    const $el = $(el)
    const strong = $el.children("strong").first()
    if (!strong.length) return

    const strongText = strong.text().trim()
    if (
      !/hotel|center|convention|hall|arena|stadium|resort|inn|suites|venue/i.test(
        strongText
      )
    )
      return

    venueFullName = strongText.replace(/,$/, "").trim()

    const fullText = $el.text()
    const lines = fullText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)

    const afterVenue = lines.slice(1)

    if (afterVenue[0]) venueAddress = afterVenue[0]

    if (afterVenue[1]) {
      const raw = afterVenue[1].replace(/,$/, "")
      const commaIdx = raw.indexOf(",")
      if (commaIdx > -1) {
        venueCity = raw.slice(0, commaIdx).trim()
        const stateZip = raw
          .slice(commaIdx + 1)
          .trim()
          .split(/\s+/)
        venueState = stateZip[0] || null
        venuePostalCode = stateZip[1] || null
      } else {
        venueCity = raw.trim()
      }
    }

    if (afterVenue[2]) venueCountry = afterVenue[2].replace(/,$/, "").trim()

    return false
  })

  // ---- Deadlines ----
  let registrationDeadline: string | null = null
  let submissionDeadline: string | null = null

  $("dt, th, [class*='label']").each((_, el) => {
    const label = $(el).text().trim().toLowerCase()
    const value =
      $(el).next("dd, td, [class*='value']").text().trim() ||
      $(el).siblings("dd, td").first().text().trim()

    if (label.includes("registration") && value) {
      registrationDeadline = value
    }
    if ((label.includes("submission") || label.includes("abstract")) && value) {
      submissionDeadline = value
    }
  })

  return {
    officialWebsite,
    venueFullName,
    venueAddress,
    venueCity,
    venueState,
    venuePostalCode,
    venueCountry,
    organizerName,
    organizerOrg,
    organizerEmail,
    organizerPhone,
    description,
    registrationDeadline,
    submissionDeadline,
  }
}

export async function scrapeICA(options?: {
  citySlugs?: string[]
  months?: string[]
  maxPagesPerSlug?: number
  maxDetailPages?: number
  skipDetailPages?: boolean
  pagesPerBatch?: number
  onBatch?: (events: ICAEvent[]) => Promise<void>
}): Promise<{ events: ICAEvent[]; hasMore: boolean }> {
  const slugs = options?.citySlugs ?? Object.keys(ICA_CITY_SLUGS)
  const months = options?.months ?? ICA_MONTHS
  const maxPages = options?.maxPagesPerSlug ?? 999
  const maxDetail = options?.maxDetailPages ?? Infinity
  const skipDetail = options?.skipDetailPages ?? false
  const pagesPerBatch = options?.pagesPerBatch ?? 999
  const onBatch = options?.onBatch

  const browser = await puppeteer.launch({
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

  const allResults: ICAEvent[] = []
  const seenUrls = new Set<string>()
  let pagesSinceBatch = 0
  let batchEvents: ICAEvent[] = []

  try {
    for (const slug of slugs) {
      const cityMeta = ICA_CITY_SLUGS[slug] ?? { city: slug, state: null }

      for (const month of months) {
        const baseUrl = `${BASE}/united-states/${slug}/${month}`
        let pageNum = 1
        let totalPages = 1

        while (pageNum <= maxPages) {
          const url = pageNum === 1 ? baseUrl : `${baseUrl}?page=${pageNum}`
          console.log(`[ICA] Listing: ${url}`)

          const { cards, totalPages: tp } = await fetchListingPage(page, url)
          if (pageNum === 1) totalPages = tp
          if (cards.length === 0) break

          for (const card of cards) {
            if (seenUrls.has(card.url)) continue
            seenUrls.add(card.url)

            const dates = parseDates(card.dateText)
            const acronym = extractAcronym(card.name)
            const cleanName = card.name
              .replace(/\s*\([A-Z0-9\-]{2,12}\)\s*$/, "")
              .trim()

            let detail: Partial<DetailResult> = {}

            if (!skipDetail && seenUrls.size <= maxDetail) {
              console.log(`[ICA] Detail: ${card.url}`)
              try {
                detail = await scrapeDetailPage(page, card.url)
              } catch (err) {
                console.error(`[ICA] Detail error ${card.url}:`, err)
              }
              await wait(jitter(2500))
            }

            const ev: ICAEvent = {
              eventName: cleanName,
              eventAcronym: acronym,
              eventType: card.eventType,
              eventTopic: card.eventTopic,
              eventDateStart: dates.start,
              eventDateEnd: dates.end,
              eventUrl: card.url,
              officialWebsite: detail.officialWebsite ?? null,
              venueFullName: detail.venueFullName ?? null,
              venueAddress: detail.venueAddress ?? null,
              venueCity: detail.venueCity ?? card.city ?? cityMeta.city,
              venueState: detail.venueState ?? cityMeta.state,
              venueCountry:
                detail.venueCountry ?? card.country ?? "United States",
              contacts: [
                {
                  organizerName: detail.organizerName ?? null,
                  organizerOrg: detail.organizerOrg ?? null,
                  organizerEmail: detail.organizerEmail ?? null,
                  organizerPhone: detail.organizerPhone ?? null,
                  organizerLinkedIn: null,
                },
              ],
              description: detail.description ?? null,
              registrationDeadline: detail.registrationDeadline ?? null,
              submissionDeadline: detail.submissionDeadline ?? null,
              expectedAttendees: null,
              sourceSite: "internationalconferencealerts.com",
            }

            batchEvents.push(ev)
            allResults.push(ev)
          }

          pageNum++
          pagesSinceBatch++
          await wait(jitter(1500))

          if (pagesSinceBatch >= pagesPerBatch && onBatch) {
            console.log(`[ICA] Batch of ${pagesSinceBatch} pages complete, saving ${batchEvents.length} events to DB`)
            await onBatch([...batchEvents])
            batchEvents = []
            pagesSinceBatch = 0
            console.log(`[ICA] Resuming scraping...`)
          }
        }
      }
    }
  } finally {
    await browser.close()
  }

  if (batchEvents.length > 0 && onBatch) {
    await onBatch(batchEvents)
    batchEvents = []
  }

  allResults.sort(
    (a, b) =>
      new Date(a.eventDateStart).getTime() -
      new Date(b.eventDateStart).getTime()
  )

  return { events: allResults, hasMore: false }
}
