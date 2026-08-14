import * as cheerio from "cheerio"

const BASE = "https://www.tradefairdates.com"
const LIST_URL = `${BASE}/Fairs-USA-Z228-S`

const MONTH_MAP: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
}

export interface TradeFairDateEvent {
  eventName: string
  eventDateStart: Date | null
  eventDateEnd: Date | null
  venueName: string | null
  city: string | null
  detailUrl: string
  contactEmail: string | null
  websiteUrl: string | null
  description: string | null
  sourceSite: "tradefairdates.com"
}

function parseDateText(text: string): { start: Date | null; end: Date | null } {
  const clean = text.replace(/\s+/g, " ").trim()
  // "21. - 26. July 2026" or "27 Jul. - 02 Aug. 2026"
  const rangeMatch = clean.match(
    /^(\d{1,2})\.?\s*(?:([A-Za-z]+)\.?)?\s*[-–]\s*(\d{1,2})\.?\s+([A-Za-z]+)\.?\s+(\d{4})$/
  )
  if (rangeMatch) {
    const startDay = parseInt(rangeMatch[1], 10)
    const startMonthStr = (rangeMatch[2] || rangeMatch[4]).toLowerCase().slice(0, 3)
    const endDay = parseInt(rangeMatch[3], 10)
    const endMonthStr = rangeMatch[4].toLowerCase().slice(0, 3)
    const year = parseInt(rangeMatch[5], 10)
    const startMi = MONTH_MAP[startMonthStr]
    const endMi = MONTH_MAP[endMonthStr]
    if (startMi !== undefined && endMi !== undefined) {
      return {
        start: new Date(Date.UTC(year, startMi, startDay)),
        end: new Date(Date.UTC(year, endMi, endDay)),
      }
    }
  }

  // "21. - 26. July 2026" — same month, month only on the right
  const sameMonthMatch = clean.match(
    /^(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.?\s+([A-Za-z]+)\.?\s+(\d{4})$/
  )
  if (sameMonthMatch) {
    const startDay = parseInt(sameMonthMatch[1], 10)
    const endDay = parseInt(sameMonthMatch[2], 10)
    const monthStr = sameMonthMatch[3].toLowerCase().slice(0, 3)
    const year = parseInt(sameMonthMatch[4], 10)
    const mi = MONTH_MAP[monthStr]
    if (mi !== undefined) {
      return {
        start: new Date(Date.UTC(year, mi, startDay)),
        end: new Date(Date.UTC(year, mi, endDay)),
      }
    }
  }

  return { start: null, end: null }
}

export async function scrapeTradeFairDatesEvents(
  maxPages: number = 50
): Promise<TradeFairDateEvent[]> {
  const seen = new Set<string>()
  const events: TradeFairDateEvent[] = []

  for (let page = 1; page <= maxPages; page++) {
    const url = `${LIST_URL}${page}.html`
    console.log(`[tradefairdates] Fetching page ${page}: ${url}`)

    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!resp.ok) {
      if (resp.status === 404) break
      throw new Error(`HTTP ${resp.status}`)
    }
    const html = await resp.text()

    // Check for empty page
    if (html.includes("not aware of any current trade fair dates")) {
      console.log(`[tradefairdates] Page ${page} is empty — stopping`)
      break
    }

    const $ = cheerio.load(html)

    let tileCount = 0
    $(".messeninfoTile").each((_, el) => {
      const $tile = $(el)
      const link = $tile.find("a.moodPictureContainer2").first()
      const href = link.attr("href") || ""

      const eventName = $tile.find(".tileMeta .title").first().text().trim()
      const venueName = $tile.find(".messeTerminZentrum a").first().text().trim() || null
      const city = $tile.find(".messeTerminOrt").first().text().trim() || null

      const timeText = $tile.find(".time").first().text().trim()
      const { start: eventDateStart, end: eventDateEnd } = parseDateText(timeText)

      if (!eventName || !href) return

      const dedupKey = `${eventName}|${city ?? ""}|${eventDateStart?.toISOString().slice(0, 10) ?? ""}`
      if (seen.has(dedupKey)) return
      seen.add(dedupKey)

      const detailUrl = href.startsWith("http") ? href : `${BASE}${href}`

      events.push({
        eventName,
        eventDateStart,
        eventDateEnd,
        venueName,
        city,
        detailUrl,
        contactEmail: null,
        websiteUrl: null,
        description: null,
        sourceSite: "tradefairdates.com",
      })
      tileCount++
    })

    console.log(`[tradefairdates] Page ${page}: ${tileCount} events`)

    // Check if there's a next page in pagination
    const pageLinks = $(".pagination a.page-link")
    const pageNumbers = new Set<number>()
    pageLinks.each((_, a) => {
      const m = $(a).attr("href")?.match(/S(\d+)\.html/)
      if (m) pageNumbers.add(parseInt(m[1], 10))
    })
    const maxListed = Math.max(...pageNumbers, 0)
    if (page >= maxListed) break
  }

  console.log(`[tradefairdates] ${events.length} total events from listing pages`)
  return events
}

export async function enrichTradeFairDateEvent(
  event: TradeFairDateEvent
): Promise<TradeFairDateEvent> {
  const resp = await fetch(event.detailUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(20000),
  })
  if (!resp.ok) return event
  const html = await resp.text()
  const $ = cheerio.load(html)

  // Extract description from main content area
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
  console.log(`[tradefairdates] Description extracted: ${description ? `${description.length} chars` : "none"}`)

  const contactSection = $("#messekontakt")
  if (!contactSection.length) return { ...event, description }

  const websiteSpan = contactSection.find('[data-role="gothere"]')
  const websiteUrl = websiteSpan.text().trim() || null

  const emailBtn = contactSection.find(".getEmail")
  const dataTab = emailBtn.attr("data-tab") || ""
  const dataId = emailBtn.attr("data-id") || ""

  let contactEmail: string | null = null
  if (dataTab && dataId) {
    try {
      const emailResp = await fetch(`${BASE}/get_email.php`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Referer: event.detailUrl,
        },
        body: `tab=${encodeURIComponent(dataTab)}&id=${encodeURIComponent(dataId)}`,
        signal: AbortSignal.timeout(10000),
      })
      if (emailResp.ok) {
        const emailHtml = await emailResp.text()
        const emailMatch = emailHtml.match(/mailto:([^"<]+)/)
        if (emailMatch) contactEmail = emailMatch[1].trim()
      }
    } catch {
      // email fetch failed, skip
    }
  }

  return { ...event, contactEmail, websiteUrl, description }
}

export async function scrapeTradeFairDatesWithDetails(
  maxPages?: number
): Promise<TradeFairDateEvent[]> {
  const listing = await scrapeTradeFairDatesEvents(maxPages)
  console.log(`[tradefairdates] Enriching ${listing.length} events with contact details...`)

  const enriched: TradeFairDateEvent[] = []
  for (let i = 0; i < listing.length; i++) {
    const ev = await enrichTradeFairDateEvent(listing[i])
    enriched.push(ev)
    if ((i + 1) % 10 === 0) {
      console.log(`[tradefairdates] Enriched ${i + 1}/${listing.length} events`)
    }
  }

  return enriched
}
