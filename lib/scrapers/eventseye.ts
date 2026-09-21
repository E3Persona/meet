import * as cheerio from "cheerio"
import type { Browser, Page } from "puppeteer"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"

puppeteer.use(StealthPlugin())

const BASE = "https://www.eventseye.com"
const LISTING_URL = `${BASE}/fairs/upcoming_trade_shows.html`

// ---------- Types ----------

export interface EventseyeCompany {
  name: string
  link: string | null
  addressLines: string[]
  country: string | null
  phone: string | null
  fax: string | null
  website: string | null
  email: string | null
}

export interface EventseyeDateEntry {
  dateText: string
  city: string | null
  cityLink: string | null
  venueName: string | null
}

export interface EventseyeEventCard {
  title: string
  detailUrl: string | null
  listingDate: string | null
}

export interface EventseyeEvent extends EventseyeEventCard {
  description: string | null
  industries: string[]
  audience: string | null
  cycle: string | null
  dates: EventseyeDateEntry[]
  venues: EventseyeCompany[]
  organizers: EventseyeCompany[]
  officialWebsite: string | null
  eventEmail: string | null
  organizerContact: {
    name: string | null
    email: string | null
    phone: string | null
    website: string | null
  } | null
  expectedAttendees: number | null
  sourceSite: "eventseye.com"
}

export interface ScrapeEventseyeOptions {
  maxDetailPages?: number
  withDetails?: boolean
  executablePath?: string
  targetCity?: string // if set, only return events matching this city
  targetCities?: string[] // if set, only return events matching any of these cities
}

interface EventseyeDetailResult {
  description: string | null
  industries: string[]
  audience: string | null
  cycle: string | null
  dates: EventseyeDateEntry[]
  venues: EventseyeCompany[]
  organizers: EventseyeCompany[]
  officialWebsite: string | null
  eventEmail: string | null
}

// ---------- Helpers ----------

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const jitter = (baseMs: number) => baseMs + Math.random() * baseMs * 0.5

function resolveUrl(
  href: string | undefined | null,
  base: string = BASE
): string | null {
  if (!href) return null
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function splitByBr(html: string | null | undefined): string[] {
  if (!html) return []
  return html.split(/<br\s*\/?>/i)
}

function chunkText(chunk: string): string {
  const $c = cheerio.load(`<div>${chunk}</div>`)
  return $c("div").text().replace(/\s+/g, " ").trim()
}

function isCloudflareChallenge(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  return (
    text.includes("Just a moment") ||
    text.includes("Enable JavaScript and cookies")
  )
}

async function gotoWithRetry(
  page: Page,
  url: string,
  attempts = 3
): Promise<string> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      let html = await page.content()
      if (isCloudflareChallenge(html)) {
        await wait(4000)
        try {
          await page.waitForNavigation({
            waitUntil: "domcontentloaded",
            timeout: 15000,
          })
        } catch {
          // no navigation fired; re-read content anyway
        }
        html = await page.content()
      }
      return html
    } catch (err) {
      lastErr = err as Error
      if (attempt < attempts - 1) await wait(2000)
    }
  }
  throw new Error(
    `Failed to load ${url}: ${lastErr?.message ?? "unknown error"}`
  )
}

// Parses one venue/organizer "div.text" block (Venue uses a.placelink + a.countrylink,
// Organizer uses a.orglink + <strong> for country) into a typed EventseyeCompany.
function extractCompanyInfo(
  divTextHtml: string,
  pageUrl: string
): EventseyeCompany {
  const chunks = splitByBr(divTextHtml)

  let name = ""
  let link: string | null = null
  const addressLines: string[] = []
  let country: string | null = null
  let phone: string | null = null
  let fax: string | null = null
  let website: string | null = null
  let email: string | null = null

  chunks.forEach((raw, idx) => {
    const text = chunkText(raw)

    if (idx === 0) {
      const $c = cheerio.load(`<div>${raw}</div>`)
      const $a = $c("a.placelink, a.orglink").first()
      if ($a.length) {
        name = $a.text().trim()
        link = resolveUrl($a.attr("href"), pageUrl)
      }
      return
    }

    if (raw.includes("countrylink") || /<strong/i.test(raw)) {
      if (text) country = text
      return
    }

    if (
      raw.includes("ev-phone") ||
      raw.includes("ev-fax") ||
      raw.includes("ev-web") ||
      raw.includes("ev-mail")
    ) {
      const $c = cheerio.load(`<div>${raw}</div>`)
      const $phone = $c(".ev-phone")
      if ($phone.length) phone = $phone.text().trim() || null
      const $fax = $c(".ev-fax")
      if ($fax.length) fax = $fax.text().trim() || null
      const $web = $c("a.ev-web")
      if ($web.length) website = $web.attr("href") ?? null
      const $mail = $c("a.ev-mail")
      if ($mail.length) {
        const href = $mail.attr("href")
        email = href ? href.replace(/^mailto:/i, "").trim() : null
      }
      return
    }

    if (text) addressLines.push(text)
  })

  return { name, link, addressLines, country, phone, fax, website, email }
}

// ---------- Listing page ----------

async function fetchListingCards(page: Page): Promise<EventseyeEventCard[]> {
  const html = await gotoWithRetry(page, LISTING_URL)
  const $ = cheerio.load(html)

  const cards: EventseyeEventCard[] = []
  const seen = new Set<string>()

  $("table tbody tr").each((_, tr) => {
    const $tds = $(tr).find("td")
    if ($tds.length < 2) return

    const $a = $tds.eq(0).find('a[href^="f-"]').first()
    if (!$a.length) return

    const title = $a.text().trim()
    const detailUrl = resolveUrl($a.attr("href"), LISTING_URL)
    if (!detailUrl || seen.has(detailUrl)) return
    seen.add(detailUrl)

    const listingDate = $tds.eq(1).text().trim() || null

    cards.push({ title, detailUrl, listingDate })
  })

  return cards
}

// ---------- Detail page ----------

async function scrapeDetailPage(
  page: Page,
  url: string
): Promise<EventseyeDetailResult> {
  const html = await gotoWithRetry(page, url)
  const $ = cheerio.load(html)

  const description =
    $('h2:contains("Description")').nextUntil("h2").text().trim() ||
    $(".description").text().trim() ||
    null
  console.log(`[eventseye] Description extracted: ${description ? `${description.length} chars` : "none"}`)

  const industries: string[] = []
  $('h2:contains("Related industries")')
    .nextUntil("h2")
    .find("a")
    .each((_, a) => {
      const t = $(a).text().trim()
      if (t) industries.push(t)
    })

  const audience = $('h2:contains("Audience")').next().text().trim() || null
  const cycle = $('h2:contains("Cycle")').next().text().trim() || null

  // Dates / City / Venue table
  const dates: EventseyeDateEntry[] = []
  $("table")
    .filter((_, t) =>
      $(t).find("th, td").text().toLowerCase().includes("venue")
    )
    .first()
    .find("tbody tr")
    .each((_, tr) => {
      const $tds = $(tr).find("td")
      if ($tds.length < 3) return
      const dateText = $tds.eq(0).text().replace(/\s+/g, " ").trim()
      const $cityA = $tds.eq(1).find("a").first()
      const city = $cityA.length
        ? $cityA.text().trim()
        : $tds.eq(1).text().trim() || null
      const cityLink = resolveUrl($cityA.attr("href"), url)
      const venueName = $tds.eq(2).text().trim() || null
      if (dateText) dates.push({ dateText, city, cityLink, venueName })
    })

  // Venue(s) and Organizer(s) — each is a div.text block identified by its inner link class
  const venues: EventseyeCompany[] = []
  $("div.text").each((_, el) => {
    const $el = $(el)
    if ($el.find("a.placelink").length) {
      venues.push(extractCompanyInfo($el.html() ?? "", url))
    }
  })

  const organizers: EventseyeCompany[] = []
  $("div.text").each((_, el) => {
    const $el = $(el)
    if ($el.find("a.orglink").length) {
      organizers.push(extractCompanyInfo($el.html() ?? "", url))
    }
  })

  const officialWebsite =
    $('h2:contains("Contact info")').nextAll("a").first().attr("href") ?? null

  const eventEmail =
    $('a[href^="mailto:"]')
      .filter((_, a) => !!$(a).attr("href") && $(a).attr("href") !== "mailto:")
      .first()
      .attr("href")
      ?.replace(/^mailto:/i, "")
      .trim() ?? null

  return {
    description,
    industries,
    audience,
    cycle,
    dates,
    venues,
    organizers,
    officialWebsite,
    eventEmail,
  }
}

// ---------- Orchestration ----------

export async function scrapeEventseye(
  options: ScrapeEventseyeOptions = {}
): Promise<EventseyeEvent[]> {
  const {
    maxDetailPages = Infinity,
    withDetails = true,
    executablePath = "/usr/bin/google-chrome",
    targetCity,
    targetCities,
  } = options

  const browser: Browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--window-size=1920,1080",
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })

  const events: EventseyeEvent[] = []
  let detailsVisited = 0

  try {
    console.log(`[eventseye] listing page: ${LISTING_URL}`)
    const cards = await fetchListingCards(page)

    for (const card of cards) {
      let detail: EventseyeDetailResult = {
        description: null,
        industries: [],
        audience: null,
        cycle: null,
        dates: [],
        venues: [],
        organizers: [],
        officialWebsite: null,
        eventEmail: null,
      }

      if (withDetails && card.detailUrl && detailsVisited < maxDetailPages) {
        console.log(`[eventseye]   detail: ${card.detailUrl}`)
        try {
          detail = await scrapeDetailPage(page, card.detailUrl)
          detailsVisited++
        } catch (err) {
          console.error(`[eventseye] detail failed for ${card.detailUrl}:`, err)
        }
        await wait(jitter(800))
      }

      const org = detail.organizers?.[0]
      events.push({
        ...card,
        ...detail,
        organizerContact: org
          ? {
              name: org.name || null,
              email: org.email || null,
              phone: org.phone || null,
              website: org.website || null,
            }
          : null,
        expectedAttendees: null,
        sourceSite: "eventseye.com",
      })
    }

    if (targetCities && targetCities.length > 0) {
      const lcs = targetCities.map((c) => c.toLowerCase())
      return events.filter(
        (ev) =>
          ev.dates.some((d) =>
            lcs.some((lc) => d.city?.toLowerCase().includes(lc))
          ) ||
          ev.venues.some((v) =>
            lcs.some(
              (lc) =>
                v.name?.toLowerCase().includes(lc) ||
                v.addressLines.some((a) => a.toLowerCase().includes(lc))
            )
          )
      )
    }

    if (targetCity) {
      const lc = targetCity.toLowerCase()
      return events.filter(
        (ev) =>
          ev.dates.some((d) => d.city?.toLowerCase().includes(lc)) ||
          ev.venues.some(
            (v) =>
              v.name?.toLowerCase().includes(lc) ||
              v.addressLines.some((a) => a.toLowerCase().includes(lc))
          )
      )
    }
  } finally {
    await browser.close()
  }

  return events
}
