import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import * as cheerio from "cheerio"

puppeteer.use(StealthPlugin())

const BASE = "https://tickets.gaylordnational.com"
const EVENTS_URL = `${BASE}/`

const VENUE = {
  name: "Gaylord National Resort & Convention Center",
  address: "201 Waterfront Street, National Harbor, MD 20745",
  phone: "1-301-965-4000",
}

export interface GaylordNationalEvent {
  eventId: string
  eventName: string
  category: string | null
  badge: string | null
  isFree: boolean
  scheduleText: string | null
  eventDateStart: Date | null
  eventDateEnd: Date | null
  description: string | null
  priceText: string | null
  imageUrl: string | null
  ticketUrl: string | null
  sourceUrl: string
  sourceSite: "tickets.gaylordnational.com"
  venueName: string
  venueAddress: string
  venuePhone: string
}

function absoluteUrl(url: string | undefined | null): string | null {
  if (!url) return null
  if (url.startsWith("//")) return `https:${url}`
  if (url.startsWith("http")) return url
  return new URL(url, BASE).toString()
}

function extractBgImage(style: string | undefined): string | null {
  if (!style) return null
  const match = style.match(/url\((.*?)\)/)
  if (!match) return null
  return absoluteUrl(match[1].replace(/['"]/g, "").trim())
}

function parseDateRange(text: string | null): { start: Date | null; end: Date | null } {
  if (!text) return { start: null, end: null }
  const parts = text.split(/\s*-\s*/)
  const parseOne = (s: string) => {
    const d = new Date(s.trim() + " UTC")
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (parts.length === 2) {
    return { start: parseOne(parts[0]), end: parseOne(parts[1]) }
  }
  const single = parseOne(text)
  return { start: single, end: single }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function scrapeGaylordNationalEvents(): Promise<GaylordNationalEvent[]> {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1920, height: 1080 })

    await page.goto(EVENTS_URL, { waitUntil: "networkidle2", timeout: 30000 })
    // Extra settle time for carousel JS
    await wait(3000)

    const html = await page.content()
    const $ = cheerio.load(html)
    const events: GaylordNationalEvent[] = []

    $("#swEventList > section.featuredevent-box").each((_, section) => {
      const $section = $(section)

      const classAttr = $section.attr("class") || ""
      const boxMatch = classAttr.match(/featuredbox-(\d+)/)
      const boxIndex = boxMatch ? boxMatch[1] : null

      const eventId = ($section.attr("id") || "").replace("event-", "")
      const eventName = $section.find(".featuredevent-title").first().text().trim()
      const category = $section.find(".featuredevent-description").first().text().trim() || null

      const $favLink = $section.find(".fav-link").first()
      const isFree = $favLink.attr("data-isfree") === "1"
      const listLink = absoluteUrl($favLink.attr("data-link"))

      const badgeSpan = $section.find(".showinfolabelonimage").first()
      const badgeStyle = badgeSpan.attr("style") || ""
      const badgeText = badgeSpan.text().trim()
      const badge = badgeText && !badgeStyle.includes("display: none") ? badgeText : null

      const imageUrl = extractBgImage($section.find(".background-wrap").first().attr("style"))

      const $panel = boxIndex !== null ? $(`.highlightinfo-wrap.featuredbox-${boxIndex}`) : $()

      const scheduleText =
        $panel.find(".highlight-date").first().text().trim() ||
        $panel.find(".highlight-schedule").first().text().trim() ||
        null
      const { start: eventDateStart, end: eventDateEnd } = parseDateRange(
        $panel.find(".highlight-date").first().text().trim() || null
      )

      const description = $panel.find(".description").first().text().trim().replace(/\s+/g, " ") || null
      console.log(`[gaylordnational] Description extracted: ${description ? `${description.length} chars` : "none"}`)
      const priceText = $panel.find(".event-pricing-wrap .pricing-item").first().text().trim() || null

      const ticketUrl =
        absoluteUrl($panel.find(".button-wrap a.buy-tickets").first().attr("href")) ||
        absoluteUrl($panel.find("a.buy-tickets").first().attr("href")) ||
        listLink

      if (!eventName || !eventId) return

      events.push({
        eventId,
        eventName,
        category,
        badge,
        isFree,
        scheduleText,
        eventDateStart,
        eventDateEnd,
        description,
        priceText,
        imageUrl,
        ticketUrl,
        sourceUrl: `${EVENTS_URL}#event-${eventId}`,
        sourceSite: "tickets.gaylordnational.com",
        venueName: VENUE.name,
        venueAddress: VENUE.address,
        venuePhone: VENUE.phone,
      })
    })

    console.log(`[gaylordnational] ${events.length} events parsed`)
    return events
  } finally {
    await browser.close()
  }
}
