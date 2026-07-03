import * as cheerio from "cheerio"
import { createJinaProvider } from "../providers/scrape/jina"

const BASE = "https://www.sgmp.org"
const CALENDAR_URL = `${BASE}/index.php?option=com_jevents&Itemid=115&task=month.calendar`

export interface SGMPEvent {
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  startTime: string | null
  endTime: string | null
  category: string | null
  description: string | null
  venueName: string | null
  venueAddress: string | null
  venueCity: string | null
  venueState: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  sourceUrl: string
  sourceSite: "sgmp.org"
}

export interface SGMPOptions {
  maxMonths?: number
  startYear?: number
  startMonth?: number
}

const BASE_DETAIL = `${BASE}/index.php?option=com_jevents&task=icalrepeat.detail`

function resolveUrl(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    return new URL(href, BASE).toString()
  } catch {
    return null
  }
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (attempt < attempts - 1) await delay(2000)
      else throw err
    }
  }
  throw new Error(`Failed to fetch after ${attempts} attempts`)
}

function htmlToText(html: string): string {
  return cheerio.load(`<div>${html}</div>`).text().replace(/\s+/g, " ").trim()
}

function extractEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[a-z.]{2,}/i)
  return m ? m[0] : null
}

function extractPhone(text: string): string | null {
  const m = text.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
  return m ? m[0].trim() : null
}

function parseSGMPDate(dateStr: string): string | null {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0]
}

interface CalendarEventLink {
  title: string
  detailUrl: string
}

async function scrapeCalendarMonth(
  year: number,
  month: number
): Promise<{ events: CalendarEventLink[]; nextUrl: string | null }> {
  const url = `${CALENDAR_URL}&year=${year}&month=${month.toString().padStart(2, "0")}&day=01`
  console.log(`[sgmp] calendar: ${url}`)
  const html = await fetchWithRetry(url)
  const $ = cheerio.load(html)
  const events: CalendarEventLink[] = []
  const seen = new Set<string>()

  $("a.cal_titlelink").each((_, el) => {
    const href = $(el).attr("href")
    const title = $(el).text().trim()
    if (!title || !href) return
    const resolved = resolveUrl(href)
    if (!resolved || seen.has(resolved)) return
    seen.add(resolved)
    events.push({ title, detailUrl: resolved })
  })

  let nextUrl: string | null = null
  const nextLink = $('a[title="Next month"]').first()
  if (nextLink.length) {
    const href = nextLink.attr("href")
    if (href) nextUrl = resolveUrl(href)
  }

  return { events, nextUrl }
}

async function scrapeDetailPage(
  url: string,
  evid: string
): Promise<{
  eventDateStart: string | null
  eventDateEnd: string | null
  startTime: string | null
  endTime: string | null
  category: string | null
  description: string | null
  venueName: string | null
  venueAddress: string | null
  venueCity: string | null
  venueState: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
}> {
  let html: string
  try {
    html = await fetchWithRetry(url)
  } catch {
    console.log(`[sgmp] HTML fetch failed for ${url}, falling back to Jina`)
    return scrapeDetailViaJina(url)
  }

  const $ = cheerio.load(html)
  const title = $(".mc-event-details-title").first().text().trim()

  const dateText = $(".event-start-date").first().text().trim()
  const startTime = $(".event-start-time").first().text().trim() || null
  const endTime = $(".event-stop-time").first().text().trim() || null

  const eventDateStart = dateText ? parseSGMPDate(dateText) : null

  const categoryEl = $(".event-category").first()
  const category = categoryEl.length
    ? categoryEl.text().replace("Category:", "").trim()
    : null

  const contentHtml = $(".mc-event-details").html() ?? ""
  const description = htmlToText(contentHtml) || null

  let venueName: string | null = null
  let venueAddress: string | null = null
  let venueCity: string | null = null
  let venueState: string | null = null
  let contactName: string | null = null
  let contactEmail: string | null = null
  let contactPhone: string | null = null

  const locationMatch = contentHtml.match(/<strong>Location:<\/strong>\s*([^<]+)/i)
  if (locationMatch) {
    const locText = locationMatch[1].trim()
    const parts = locText.split(",").map((s) => s.trim())
    venueName = parts[0] || null
    if (parts.length >= 2) {
      const lastPart = parts[parts.length - 1]
      const cityStateMatch = lastPart.match(/([A-Za-z\s.]+)\s+([A-Z]{2})\s+\d{5}/)
      if (cityStateMatch) {
        venueCity = cityStateMatch[1].trim()
        venueState = cityStateMatch[2]
        venueAddress = locText
      } else {
        const stateMatch = locText.match(/([A-Za-z\s.]+),\s*([A-Z]{2})\b/)
        if (stateMatch) {
          venueCity = stateMatch[1].trim()
          venueState = stateMatch[2]
          venueAddress = locText
        }
      }
    }
  }

  const email = extractEmail(contentHtml)
  if (email) contactEmail = email

  const phone = extractPhone(contentHtml)
  if (phone) contactPhone = phone

  const contactLabelMatch = contentHtml.match(/<strong>(Contact|Organizer|Chapter President|Coordinator)[:\s]*<\/strong>\s*([^<]+)/i)
  if (contactLabelMatch) {
    const name = contactLabelMatch[2].trim()
    if (name && name.length > 2 && !name.includes("@")) contactName = name
  }

  return {
    eventDateStart,
    eventDateEnd: null,
    startTime,
    endTime,
    category,
    description,
    venueName,
    venueAddress,
    venueCity,
    venueState,
    contactName,
    contactEmail,
    contactPhone,
  }
}

async function scrapeDetailViaJina(
  url: string
): Promise<{
  eventDateStart: string | null
  eventDateEnd: string | null
  startTime: string | null
  endTime: string | null
  category: string | null
  description: string | null
  venueName: string | null
  venueAddress: string | null
  venueCity: string | null
  venueState: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
}> {
  const jina = createJinaProvider()
  const result = await jina.scrape(url, { timeout: 30000 })

  if (!result.markdown) {
    console.warn(`[sgmp] Jina returned no content for ${url}`)
    return {
      eventDateStart: null, eventDateEnd: null, startTime: null, endTime: null,
      category: null, description: null, venueName: null, venueAddress: null,
      venueCity: null, venueState: null, contactName: null, contactEmail: null,
      contactPhone: null,
    }
  }

  const md = result.markdown
  const email = extractEmail(md)
  const phone = extractPhone(md)

  let dateStart: string | null = null
  const dateMatch = md.match(/(\w+day,\s+\w+\s+\d{1,2},?\s*\d{4})/)
  if (dateMatch) {
    const d = new Date(dateMatch[1])
    if (!isNaN(d.getTime())) dateStart = d.toISOString().split("T")[0]
  }

  let venueName: string | null = null
  let venueCity: string | null = null
  let venueState: string | null = null
  const locMatch = md.match(/\*\*Location\*\*:?\s*(.+)/i)
  if (locMatch) {
    const locText = locMatch[1].trim()
    const parts = locText.split(",").map((s) => s.trim())
    venueName = parts[0] || null
    const cityStateMatch = locText.match(/([A-Za-z\s.]+)\s+([A-Z]{2})\s+\d{5}/)
    if (cityStateMatch) {
      venueCity = cityStateMatch[1].trim()
      venueState = cityStateMatch[2]
    }
  }

  return {
    eventDateStart: dateStart,
    eventDateEnd: null,
    startTime: null,
    endTime: null,
    category: null,
    description: md.slice(0, 2000) || null,
    venueName,
    venueAddress: null,
    venueCity,
    venueState,
    contactName: null,
    contactEmail: email,
    contactPhone: phone,
  }
}

export async function scrapeSgmpEvents(
  options: SGMPOptions = {}
): Promise<SGMPEvent[]> {
  const now = new Date()
  const startYear = options.startYear ?? now.getFullYear()
  const startMonth = options.startMonth ?? (now.getMonth() + 1)
  const maxMonths = options.maxMonths ?? 12

  const allEvents: SGMPEvent[] = []
  const seenUrls = new Set<string>()

  let year = startYear
  let month = startMonth
  let monthsScraped = 0

  while (monthsScraped < maxMonths) {
    const { events, nextUrl } = await scrapeCalendarMonth(year, month)
    console.log(`[sgmp] ${events.length} events found on calendar`)

    for (const ev of events) {
      if (seenUrls.has(ev.detailUrl)) continue
      seenUrls.add(ev.detailUrl)

      const evidMatch = ev.detailUrl.match(/evid=(\d+)/)
      const evid = evidMatch ? evidMatch[1] : ""

      await delay(500 + Math.random() * 500)

      try {
        const detail = await scrapeDetailPage(ev.detailUrl, evid)
        allEvents.push({
          eventName: ev.title,
          eventDateStart: detail.eventDateStart,
          eventDateEnd: detail.eventDateEnd,
          startTime: detail.startTime,
          endTime: detail.endTime,
          category: detail.category,
          description: detail.description,
          venueName: detail.venueName,
          venueAddress: detail.venueAddress,
          venueCity: detail.venueCity,
          venueState: detail.venueState,
          contactName: detail.contactName,
          contactEmail: detail.contactEmail,
          contactPhone: detail.contactPhone,
          sourceUrl: ev.detailUrl,
          sourceSite: "sgmp.org",
        })
      } catch (err) {
        console.error(`[sgmp] detail failed for ${ev.detailUrl}:`, err)
      }
    }

    if (!nextUrl) break

    const nextMatch = nextUrl.match(/year=(\d{4})&month=(\d{2})/)
    if (nextMatch) {
      year = parseInt(nextMatch[1])
      month = parseInt(nextMatch[2])
    } else {
      break
    }
    monthsScraped++
  }

  return allEvents
}
