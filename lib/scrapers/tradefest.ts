import * as cheerio from "cheerio"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"

puppeteer.use(StealthPlugin())

const BASE_URL = "https://tradefest.io"
const LISTING_PATH = "/en/selection/best-conventions-and-expos-in-usa"

export interface TFVenue {
  name: string | null
  city: string | null
  country: string | null
  venuePageUrl: string | null // internal tradefest venue profile page
}

export interface TFOrganizer {
  name: string | null
  profilePageUrl: string | null // internal tradefest organizer profile page (/en/search?organizer=...)
  officialWebsite: string | null // organizer's own outbound site, cleaned of tracking params
}

export interface TFEvent {
  rank: number | null // position in tradefest's "best of" ranking, e.g. #1, #2...
  eventName: string
  rating: number | null // out of 5, e.g. 4.2
  eventDateStart: string | null // ISO date (UTC midnight)
  eventDateEnd: string | null // ISO date (UTC midnight)
  eventDurationDays: number | null
  eventUrl: string
  venue: TFVenue
  organizer: TFOrganizer
  tags: string[]
  description: string | null
  expectedAttendees: number | null
  expectedExhibitors: number | null
  sourceSite: "tradefest.io"
}

function buildListingUrl(page: number): string {
  return `${BASE_URL}${LISTING_PATH}${page > 1 ? `?page=${page}#results` : ""}`
}

async function getBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function withRetry(fn: () => Promise<void>, label: string, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { await fn(); return } catch {
      if (attempt < retries - 1) await wait(3000)
      else throw new Error(`Failed: ${label}`)
    }
  }
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

// Parses "Jul 13, 2026" -> ISO date string (UTC midnight)
function parseShortDate(text: string): string | null {
  const m = text.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/)
  if (!m) return null
  const month = MONTHS[m[1].toLowerCase().slice(0, 3)]
  if (month === undefined) return null
  const day = parseInt(m[2], 10)
  const year = parseInt(m[3], 10)
  return new Date(Date.UTC(year, month, day)).toISOString()
}

// Strips tradefest.io tracking params (ref, utm_*) from an outbound organizer/website URL
function cleanOutboundUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl)
    u.searchParams.delete("ref")
    u.searchParams.delete("utm_campaign")
    u.searchParams.delete("utm_source")
    u.searchParams.delete("utm_medium")
    return u.toString().replace(/\?$/, "")
  } catch {
    return rawUrl
  }
}

interface RawCard {
  rank: number | null
  name: string
  url: string
  officialWebsite: string | null
  rating: number | null
  dateText: string | null
  venueName: string | null
  venueCity: string | null
  venueCountry: string | null
  venuePageUrl: string | null
  tags: string[]
}

async function scrapeListingPage(
  page: any,
  url: string
): Promise<{ cards: RawCard[]; currentPage: number; totalPages: number }> {
  await withRetry(() => page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }), `listing ${url}`)

  const result = await page.evaluate((baseUrl: string) => {
    const cards: RawCard[] = []

    // Each real event card is li.css-ptvylg; ad blocks (<ins class="adsbygoogle">)
    // sit between cards but aren't <li> elements, so this selector skips them naturally.
    const items = Array.from(
      document.querySelectorAll("li.chakra-stack")
    ) as HTMLElement[]

    for (const li of items) {
      const titleLink = li.querySelector(
        'a[href^="/en/event/"] strong'
      ) as HTMLElement | null
      if (!titleLink) continue

      const hrefEl = li.querySelector(
        'a[href^="/en/event/"]'
      ) as HTMLAnchorElement | null
      const href = hrefEl?.getAttribute("href") || ""
      if (!href) continue

      // Titles are prefixed with rank, e.g. "#1 IFMA World Workplace"
      const rawTitle = titleLink.textContent?.trim().replace(/\s+/g, " ") || ""
      const rankMatch = rawTitle.match(/^#(\d+)\s+(.*)$/)
      const rank = rankMatch ? parseInt(rankMatch[1], 10) : null
      const name = rankMatch ? rankMatch[2] : rawTitle

      // Official/outbound website link — identified structurally (nofollow + target=_blank),
      // not by Chakra's auto-generated class name.
      const outboundLink = li.querySelector(
        'a[target="_blank"][rel~="nofollow"]'
      ) as HTMLAnchorElement | null
      const officialWebsite = outboundLink?.href || null

      // Rating, e.g. "3.6 / 5"
      const ratingText =
        li.querySelector(".css-fqllj7 p")?.textContent?.trim() || ""
      const ratingMatch = ratingText.match(/([\d.]+)\s*\/\s*5/)
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null

      // Date range paragraph lives inside the rating/date row (.css-1igwmid)
      const dateText =
        li
          .querySelector(".css-1igwmid p")
          ?.textContent?.trim()
          .replace(/\s+/g, " ") || null

      // Venue paragraph is a direct child <p> of the info container (.css-1mihl21),
      // distinct from the date paragraph which is nested one level deeper.
      const infoContainer = li.querySelector(".css-1mihl21")
      const venueP = infoContainer
        ? (Array.from(infoContainer.children).find(
            (el) => el.tagName === "P"
          ) as HTMLElement | undefined)
        : undefined

      let venueName: string | null = null
      let venueCity: string | null = null
      let venueCountry: string | null = null
      let venuePageUrl: string | null = null

      if (venueP) {
        const venueLink = venueP.querySelector("a") as HTMLAnchorElement | null
        if (venueLink) {
          venuePageUrl = baseUrl + venueLink.getAttribute("href")
          venueName = venueLink.textContent?.trim().replace(/\s+/g, " ") || null
        }
        // Full text e.g. "Gaylord Palms Resort & Convention Center, Kissimmee, United States"
        const fullText = venueP.textContent?.trim().replace(/\s+/g, " ") || ""
        const parts = fullText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
        if (parts.length >= 2) {
          venueCountry = parts[parts.length - 1]
          venueCity = parts[parts.length - 2]
        }
      }

      // Tags, e.g. "#Facilities Services"
      const tags = Array.from(li.querySelectorAll(".css-zu4l97 a"))
        .map((a) => a.textContent?.trim().replace(/^#/, "") || "")
        .filter(Boolean)

      cards.push({
        rank,
        name,
        url: baseUrl + href,
        officialWebsite,
        rating,
        dateText,
        venueName,
        venueCity,
        venueCountry,
        venuePageUrl,
        tags,
      })
    }

    // "1640 results • page 1 of 55"
    const resultsText =
      document.querySelector(".css-1v235bj")?.textContent?.trim() || ""
    const pageMatch = resultsText.match(/page\s+(\d+)\s+of\s+(\d+)/i)
    const currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1
    const totalPages = pageMatch ? parseInt(pageMatch[2], 10) : 1

    return { cards, currentPage, totalPages }
  }, BASE_URL)

  return result
}

async function scrapeDetailPage(
  page: any,
  url: string
): Promise<{
  organizerName: string | null
  organizerProfileUrl: string | null
  description: string | null
  expectedAttendees: number | null
  expectedExhibitors: number | null
}> {
  await withRetry(() => page.goto(url, { waitUntil: "networkidle2", timeout: 30000 }), `detail ${url}`)

  const result = await page.evaluate((baseUrl: string) => {
    // Info box paragraphs, matched by visible label text since Chakra class
    // hashes (css-1art13b etc.) are unstable across builds.
    const paragraphs = Array.from(
      document.querySelectorAll("p")
    ) as HTMLElement[]

    let organizerName: string | null = null
    let organizerProfileUrl: string | null = null
    let expectedAttendees: number | null = null
    let expectedExhibitors: number | null = null

    for (const p of paragraphs) {
      const text = p.textContent?.trim().replace(/\s+/g, " ") || ""

      if (text.startsWith("Organizer")) {
        const link = p.querySelector(
          'a[href^="/en/search?organizer="]'
        ) as HTMLAnchorElement | null
        if (link) {
          organizerProfileUrl = baseUrl + link.getAttribute("href")
          organizerName = link.textContent?.trim().replace(/\s+/g, " ") || null
        }
      }

      if (text.toLowerCase().startsWith("expected number of attendees")) {
        const m = text.match(/(\d[\d,]*)/)
        if (m) expectedAttendees = parseInt(m[1].replace(/,/g, ""), 10)
      }

      if (text.toLowerCase().startsWith("expected number of exhibitors")) {
        const m = text.match(/(\d[\d,]*)/)
        if (m) expectedExhibitors = parseInt(m[1].replace(/,/g, ""), 10)
      }
    }

    return {
      organizerName,
      organizerProfileUrl,
      expectedAttendees,
      expectedExhibitors,
    }
  }, BASE_URL)

  const html = await page.content()
  const $ = cheerio.load(html)
  const descEl = $("article, .event-description, [class*='description'], main, .content, #content, .event-body").first()
  let description: string | null = descEl.length ? descEl.text().replace(/\s+/g, " ").trim() || null : null
  if (!description) {
    description = $("body").clone()
      .find("script, style, nav, header, footer, .sidebar, .menu, .nav, .cookie, .modal, .popup, .ad, .advertisement, .social, .share, .related, .recommended")
      .remove().end().text().replace(/\s+/g, " ").trim() || null
  }
  console.log(`[tradefest] Description extracted: ${description ? `${description.length} chars` : "none"}`)

  return { ...result, description }
}

function parseDateRange(dateText: string | null): {
  start: string | null
  end: string | null
  durationDays: number | null
} {
  if (!dateText) return { start: null, end: null, durationDays: null }

  const dateMatches = [
    ...dateText.matchAll(/[A-Za-z]{3}\s+\d{1,2},\s*\d{4}/g),
  ].map((m) => m[0])

  const start = dateMatches[0] ? parseShortDate(dateMatches[0]) : null
  const end = dateMatches[1] ? parseShortDate(dateMatches[1]) : start

  let durationDays: number | null = null
  if (start && end) {
    const diff = Math.round(
      (new Date(end).getTime() - new Date(start).getTime()) /
        (1000 * 60 * 60 * 24)
    )
    durationDays = diff + 1
  }

  return { start, end, durationDays }
}

export async function scrapeTF(options?: {
  maxPages?: number
  fetchDetails?: boolean // set false to skip detail pages entirely (much faster, but no organizer/attendee/exhibitor data)
}): Promise<TFEvent[]> {
  const maxPages = options?.maxPages ?? 55 // site currently reports 55 total pages
  const fetchDetails = options?.fetchDetails ?? true

  const browser = await getBrowser()
  const results: TFEvent[] = []
  const seenUrls = new Set<string>()

  try {
    const listingPage = await browser.newPage()
    const detailPage = fetchDetails ? await browser.newPage() : null

    let pageNum = 1

    while (pageNum <= maxPages) {
      const url = buildListingUrl(pageNum)
      console.log(`[TF] Listing: ${url}`)

      const { cards, currentPage, totalPages } = await scrapeListingPage(
        listingPage,
        url
      )

      if (cards.length === 0) break

      for (const card of cards) {
        if (seenUrls.has(card.url)) continue
        seenUrls.add(card.url)

        const { start, end, durationDays } = parseDateRange(card.dateText)

        let organizerName: string | null = null
        let organizerProfileUrl: string | null = null
        let description: string | null = null
        let expectedAttendees: number | null = null
        let expectedExhibitors: number | null = null

        if (detailPage) {
          console.log(`[TF] Detail: ${card.url}`)
          try {
            const detail = await scrapeDetailPage(detailPage, card.url)
            organizerName = detail.organizerName
            organizerProfileUrl = detail.organizerProfileUrl
            description = detail.description
            expectedAttendees = detail.expectedAttendees
            expectedExhibitors = detail.expectedExhibitors
          } catch (err) {
            console.error(`[TF] Detail error for ${card.url}:`, err)
          }
          await wait(2000) // 2s between detail pages
        }

        results.push({
          rank: card.rank,
          eventName: card.name,
          rating: card.rating,
          eventDateStart: start,
          eventDateEnd: end,
          eventDurationDays: durationDays,
          eventUrl: card.url,
          venue: {
            name: card.venueName,
            city: card.venueCity,
            country: card.venueCountry,
            venuePageUrl: card.venuePageUrl,
          },
          organizer: {
            name: organizerName,
            profilePageUrl: organizerProfileUrl,
            officialWebsite: card.officialWebsite
              ? cleanOutboundUrl(card.officialWebsite)
              : null,
          },
          tags: card.tags,
          description,
          expectedAttendees,
          expectedExhibitors,
          sourceSite: "tradefest.io",
        })
      }

      if (currentPage >= totalPages) break
      pageNum = currentPage + 1
      await wait(1500) // between listing pages
    }

    await listingPage.close()
    if (detailPage) await detailPage.close()
  } finally {
    await browser.close()
  }

  // Chronological sort
  results.sort((a, b) => {
    const at = a.eventDateStart ? new Date(a.eventDateStart).getTime() : 0
    const bt = b.eventDateStart ? new Date(b.eventDateStart).getTime() : 0
    return at - bt
  })

  return results
}
