import puppeteer from "puppeteer-core"

const BASE = "https://eventsdc.com"
const VENUE_SLUG = "walter-e-washington-convention-center"

const VENUE_NAME = "Walter E. Washington Convention Center"

export interface EventsDcEvent {
  nodeId: string
  eventName: string
  dateRangeText: string
  eventDateStart: Date | null
  eventDateEnd: Date | null
  venueName: string | null
  venueUrl: string | null
  venue: string
  detailUrl: string
  sourceUrl: string
  sourceSite: "eventsdc.com"
}

/**
 * field_end_date_value is what actually controls the list window — the
 * view returns every event ending on/before this date, not "page N of
 * results". We push it out `monthsAhead` from today rather than hardcoding
 * a fixed date, so the same code keeps working as time passes.
 *
 * The site's own URL encodes the date as "2027-01-31 12:0:0" with the
 * space as `+` and the colons as %3A — URLSearchParams reproduces that
 * exact encoding, so we build it that way instead of hand-rolling the
 * percent-escapes.
 */
function buildCalendarUrl(endDate: Date): string {
  const y = endDate.getFullYear()
  const m = String(endDate.getMonth() + 1).padStart(2, "0")
  const d = String(endDate.getDate()).padStart(2, "0")
  const params = new URLSearchParams({
    field_view: "list",
    field_end_date_value: `${y}-${m}-${d} 12:0:0`,
  })
  return `${BASE}/venue/${VENUE_SLUG}/events-calendar?${params.toString()}`
}

function parseDateRange(text: string): {
  start: Date | null
  end: Date | null
} {
  const clean = text.replace(/\s+/g, " ").trim()
  const parts = clean.split(/\s*-\s*/)
  const parseOne = (s: string) => {
    const d = new Date(s.trim() + " UTC")
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (parts.length === 2) {
    return { start: parseOne(parts[0]), end: parseOne(parts[1]) }
  }
  const single = parseOne(clean) // single-day events have no " - "
  return { start: single, end: single }
}

export async function scrapeEventsDcEvents(
  monthsAhead: number = 18
): Promise<EventsDcEvent[]> {
  const endDate = new Date()
  endDate.setMonth(endDate.getMonth() + monthsAhead)
  const startUrl = buildCalendarUrl(endDate)

  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    )
    await page.goto(startUrl, { waitUntil: "networkidle2", timeout: 45000 })

    const events: EventsDcEvent[] = []
    const seen = new Set<string>()
    let hasNextPage = true

    while (hasNextPage) {
      await page
        .waitForSelector(".views-row .calendar-item", { timeout: 15000 })
        .catch(() => {})

      const pageEvents = await page.evaluate(() => {
        const items = Array.from(
          document.querySelectorAll(".views-row .calendar-item")
        )
        return items.map((el) => {
          const article = el as HTMLElement
          const nodeId = article.getAttribute("data-history-node-id") || ""
          const detailUrl =
            article.querySelector("a")?.getAttribute("href") || ""
          const dateRangeText =
            article.querySelector(".dates")?.textContent?.trim() || ""
          const eventName =
            article.querySelector("h3 span")?.textContent?.trim() || ""
          const footerLink = article.querySelector("footer a")
          const venueName = footerLink?.textContent?.trim() || null
          const venueUrl = footerLink?.getAttribute("href") || null
          return {
            nodeId,
            detailUrl,
            dateRangeText,
            eventName,
            venueName,
            venueUrl,
          }
        })
      })

      for (const raw of pageEvents) {
        if (!raw.nodeId || !raw.eventName) continue
        if (seen.has(raw.nodeId)) continue
        seen.add(raw.nodeId)

        const { start: eventDateStart, end: eventDateEnd } = parseDateRange(
          raw.dateRangeText
        )
        const detailUrl = raw.detailUrl.startsWith("http")
          ? raw.detailUrl
          : `${BASE}${raw.detailUrl}`
        const venueUrl = raw.venueUrl
          ? raw.venueUrl.startsWith("http")
            ? raw.venueUrl
            : `${BASE}${raw.venueUrl}`
          : null

        events.push({
          nodeId: raw.nodeId,
          eventName: raw.eventName,
          dateRangeText: raw.dateRangeText,
          eventDateStart,
          eventDateEnd,
          venueName: raw.venueName,
          venueUrl,
          venue: VENUE_NAME,
          detailUrl,
          sourceUrl: startUrl,
          sourceSite: "eventsdc.com",
        })
      }

      // Drupal views expose pagers under a few different class names
      // depending on theme — check the common patterns rather than
      // assuming this particular view is a single unpaginated page.
      const nextHref = await page.evaluate(() => {
        const relNext = document.querySelector(
          'a[rel="next"]'
        ) as HTMLAnchorElement | null
        const pagerNext = document.querySelector(
          ".pager__item--next a, .pager-next a, li.pager-next a"
        ) as HTMLAnchorElement | null
        return relNext?.href || pagerNext?.href || null
      })

      if (nextHref) {
        await page.goto(nextHref, { waitUntil: "networkidle2", timeout: 45000 })
      } else {
        hasNextPage = false
      }
    }

    console.log(
      `[eventsdc] ${events.length} events parsed (through ${endDate.toDateString()})`
    )
    return events
  } finally {
    await browser.close()
  }
}
