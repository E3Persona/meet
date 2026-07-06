import * as cheerio from "cheerio"
import type { Browser, Page } from "puppeteer-core"

const BASE = "https://www.showsbee.com"

// ---------- Types ----------

export interface ShowsbeeCompany {
  name: string
  link: string | null
  address: string | null
  country: string | null
  tel: string | null
  website: string | null
}

export interface ShowsbeeEventCard {
  title: string
  detailUrl: string | null
  dateStart: string | null
  dateEnd: string | null
  venueName: string | null
  venueUrl: string | null
}

export interface ShowsbeeEvent extends ShowsbeeEventCard {
  venues: ShowsbeeCompany[]
  organizers: ShowsbeeCompany[]
  organizerContact: {
    name: string | null
    email: string | null
    phone: string | null
    website: string | null
  } | null
  expectedAttendees: number | null
  sourceSite: "showsbee.com"
}

export interface ScrapeShowsbeeOptions {
  category: string // e.g. "Professional_Shows", "Mechanical_and_Electrical_Shows"
  city?: string // e.g. "all_city", "Aberdeen_SD"
  country?: string // e.g. "United_States"
  maxPages?: number
  maxDetailPages?: number
  withDetails?: boolean
  executablePath?: string
  targetCity?: string // if set, only return events matching this city name
}

interface ShowsbeeListingResult {
  cards: ShowsbeeEventCard[]
  nextUrl: string | null
}

interface ShowsbeeDetailResult {
  venues: ShowsbeeCompany[]
  organizers: ShowsbeeCompany[]
}

// ---------- Helpers ----------

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const jitter = (baseMs: number) => baseMs + Math.random() * baseMs * 0.5

function listingUrl(opts: {
  page: number
  country: string
  city: string
  category: string
}): string {
  const { page, country, city, category } = opts
  return `${BASE}/shows-0-${page}-${country}-${city}-${category}.html`
}

function resolveUrl(href: string | undefined | null): string | null {
  if (!href) return null
  try {
    return new URL(href, BASE).toString()
  } catch {
    return null
  }
}

// Convert an HTML fragment's <br>-separated chunks into clean text lines,
// decoding entities properly instead of naive regex stripping.
function htmlChunkToText(chunk: string): string {
  const $chunk = cheerio.load(`<div>${chunk}</div>`)
  return $chunk("div").text().replace(/\s+/g, " ").trim()
}

function htmlToLines(html: string | null | undefined): string[] {
  if (!html) return []
  return html
    .split(/<br\s*\/?>/i)
    .map(htmlChunkToText)
    .filter(Boolean)
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
          // no navigation fired; fall through and re-read content anyway
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

// Find the <table> that contains a <b class="f14"> heading matching `label`
// ("Venues" or "Organizers"), and return that table's outer HTML.
function findSectionTableHtml(
  $: cheerio.CheerioAPI,
  label: string
): string | null {
  let tableHtml: string | null = null

  $("b.f14").each((_, el) => {
    if (tableHtml) return false
    const heading = $(el).text().trim().toLowerCase()
    if (heading !== label.toLowerCase()) return undefined

    const $table = $(el).closest("table")
    if ($table.length) tableHtml = $.html($table)
    return false
  })

  return tableHtml
}

// Parse one Venues/Organizers table (self-contained cheerio context) into
// a list of companies with name, link, address, country, phone, website.
function extractCompanyBlocks(sectionHtml: string): ShowsbeeCompany[] {
  const $ = cheerio.load(sectionHtml)
  const companies: ShowsbeeCompany[] = []

  $('td b a[href*="/company-"]').each((_, el) => {
    const $a = $(el)
    const name = $a.text().trim()
    const link = resolveUrl($a.attr("href"))

    const $tr = $a.closest("tr")
    const $addressTd = $tr.next("tr").find("td").first()

    let address: string | null = null
    let country: string | null = null
    let tel: string | null = null
    let website: string | null = null

    if ($addressTd.length) {
      const $countryBold = $addressTd.find("b").first()
      country = $countryBold.length ? $countryBold.text().trim() : null

      const lines = htmlToLines($addressTd.html())
      address = lines[0] ?? null

      const telLine = lines.find((l) => /^Tel:/i.test(l))
      tel = telLine ? telLine.replace(/^Tel:\s*/i, "").trim() : null

      const siteHref = $addressTd.find('a[href^="http"]').first().attr("href")
      website = siteHref ?? null
    }

    companies.push({ name, link, address, country, tel, website })
  })

  return companies
}

// ---------- Listing page ----------

async function fetchListingPage(
  page: Page,
  url: string
): Promise<ShowsbeeListingResult> {
  const html = await gotoWithRetry(page, url)
  const $ = cheerio.load(html)

  const cards: ShowsbeeEventCard[] = []

  $("td.f12").each((_, el) => {
    const $td = $(el)
    const $bold = $td.find("b").first()
    const title = $bold.text().trim()
    if (!title) return

    const lines = htmlToLines($td.html())
    const dateLine =
      lines.find((l) => /\d{1,2}\/\d{1,2}\/\d{4}/.test(l)) ?? null

    let dateStart: string | null = null
    let dateEnd: string | null = null
    if (dateLine) {
      const [start, end] = dateLine.split(" - ").map((s) => s.trim())
      dateStart = start ?? null
      dateEnd = end ?? null
    }

    const $venueA = $td.find('a[href*="/company-"]').first()
    const venueName = $venueA.length ? $venueA.text().trim() : null
    const venueUrl = resolveUrl($venueA.attr("href"))

    // Detail link: check inside this td first, then scan up to 3 preceding <tr>s
    // (the title/thumbnail row usually sits just above the text row).
    let detailUrl = resolveUrl(
      $td.find('a[href*="/fairs/"]').first().attr("href")
    )
    if (!detailUrl) {
      let $scan = $td.closest("tr").prev("tr")
      let hops = 0
      while ($scan.length && hops < 3 && !detailUrl) {
        detailUrl = resolveUrl(
          $scan.find('a[href*="/fairs/"]').first().attr("href")
        )
        $scan = $scan.prev("tr")
        hops++
      }
    }

    cards.push({ title, detailUrl, dateStart, dateEnd, venueName, venueUrl })
  })

  let nextUrl: string | null = null
  $("a").each((_, el) => {
    if (nextUrl) return false
    if ($(el).text().trim().toLowerCase() === "next") {
      nextUrl = resolveUrl($(el).attr("href"))
    }
    return undefined
  })

  return { cards, nextUrl }
}

// ---------- Detail page ----------

async function scrapeDetailPage(
  page: Page,
  url: string
): Promise<ShowsbeeDetailResult> {
  const html = await gotoWithRetry(page, url)
  const $ = cheerio.load(html)

  const venueTableHtml = findSectionTableHtml($, "Venues")
  const organizerTableHtml = findSectionTableHtml($, "Organizers")

  return {
    venues: venueTableHtml ? extractCompanyBlocks(venueTableHtml) : [],
    organizers: organizerTableHtml
      ? extractCompanyBlocks(organizerTableHtml)
      : [],
  }
}

// ---------- Orchestration ----------

export async function scrapeShowsbee(
  options: ScrapeShowsbeeOptions
): Promise<ShowsbeeEvent[]> {
  const {
    category,
    city = "all_city",
    country = "United_States",
    maxPages = 1,
    maxDetailPages = Infinity,
    withDetails = true,
    executablePath = "/usr/bin/google-chrome",
    targetCity,
  } = options

  const { launch: launchBrowser } = await import("puppeteer-core")
  const browser: Browser = await launchBrowser({
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
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  )

  const events: ShowsbeeEvent[] = []
  const seenDetailUrls = new Set<string>()

  try {
    let url: string | null = listingUrl({ page: 1, country, city, category })
    let pageCount = 0

    while (url && pageCount < maxPages) {
      console.log(`[showsbee] listing page: ${url}`)
      const { cards, nextUrl }: ShowsbeeListingResult = await fetchListingPage(
        page,
        url
      )

      for (const card of cards) {
        let venues: ShowsbeeCompany[] = []
        let organizers: ShowsbeeCompany[] = []

        if (
          withDetails &&
          card.detailUrl &&
          seenDetailUrls.size < maxDetailPages
        ) {
          if (!seenDetailUrls.has(card.detailUrl)) {
            seenDetailUrls.add(card.detailUrl)
            console.log(`[showsbee]   detail: ${card.detailUrl}`)
            try {
              const detail = await scrapeDetailPage(page, card.detailUrl)
              venues = detail.venues
              organizers = detail.organizers
            } catch (err) {
              console.error(
                `[showsbee] detail failed for ${card.detailUrl}:`,
                err
              )
            }
            await wait(jitter(800))
          }
        }

        events.push({
          ...card,
          venues,
          organizers,
          organizerContact: organizers[0]
            ? {
                name: organizers[0].name || null,
                email: null,
                phone: organizers[0].tel || null,
                website: organizers[0].website || null,
              }
            : null,
          expectedAttendees: null,
          sourceSite: "showsbee.com",
        })
      }

      url = nextUrl
      pageCount++
      await wait(jitter(500))
    }
  } finally {
    await browser.close()
  }

  if (targetCity) {
    const lc = targetCity.toLowerCase()
    return events.filter(
      (ev) =>
        ev.venueName?.toLowerCase().includes(lc) ||
        ev.venueUrl?.toLowerCase().includes(lc)
    )
  }

  return events
}
