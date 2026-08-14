import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"

puppeteer.use(StealthPlugin())

const CALENDAR_URL = "https://phillyexpocenter.com/calendar/"

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

export interface PhillyExpoCenterEvent {
  eventName: string
  eventDateStart: Date | null
  eventDateEnd: Date | null
  hall: string
  venue: string
  detailUrl: string
  sourceUrl: string
  sourceSite: "phillyexpocenter.com"
}

const VENUE_NAME = "Greater Philadelphia Expo Center at Oaks"

function parseDate(
  dateText: string,
  monthYear: string
): { start: Date | null; end: Date | null } {
  const monthMatch = monthYear.match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!monthMatch) return { start: null, end: null }
  const contextYear = parseInt(monthMatch[2], 10)

  const clean = dateText.replace(/\s+/g, " ").trim()

  // "Jul 30 - Aug 2" — cross-month range
  const crossMonth = clean.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*([A-Za-z]+)\s+(\d{1,2})$/
  )
  if (crossMonth) {
    const startMi = MONTH_MAP[crossMonth[1].toLowerCase().slice(0, 3)]
    const endMi = MONTH_MAP[crossMonth[3].toLowerCase().slice(0, 3)]
    if (startMi !== undefined && endMi !== undefined) {
      let startYear = contextYear
      let endYear = contextYear
      if (startMi > endMi) endYear = contextYear + 1
      return {
        start: new Date(Date.UTC(startYear, startMi, parseInt(crossMonth[2], 10))),
        end: new Date(Date.UTC(endYear, endMi, parseInt(crossMonth[4], 10))),
      }
    }
  }

  // "Jul 23 - 26" — same-month range, month only on left
  const sameMonth = clean.match(
    /^([A-Za-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})$/
  )
  if (sameMonth) {
    const mi = MONTH_MAP[sameMonth[1].toLowerCase().slice(0, 3)]
    if (mi !== undefined) {
      return {
        start: new Date(Date.UTC(contextYear, mi, parseInt(sameMonth[2], 10))),
        end: new Date(Date.UTC(contextYear, mi, parseInt(sameMonth[3], 10))),
      }
    }
  }

  // "Jul 25" — single day
  const single = clean.match(/^([A-Za-z]+)\s+(\d{1,2})$/)
  if (single) {
    const mi = MONTH_MAP[single[1].toLowerCase().slice(0, 3)]
    if (mi !== undefined) {
      const d = new Date(Date.UTC(contextYear, mi, parseInt(single[2], 10)))
      return { start: d, end: d }
    }
  }

  return { start: null, end: null }
}

export async function scrapePhillyExpoCenterEvents(): Promise<PhillyExpoCenterEvent[]> {
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  })

  try {
    const page = await browser.newPage()
    await page.goto(CALENDAR_URL, { waitUntil: "networkidle2", timeout: 30000 })
    await new Promise((r) => setTimeout(r, 2000))

    // Click "Load More" until hidden
    for (let i = 0; i < 10; i++) {
      const visible = await page.evaluate(() => {
        const btn = document.querySelector(".mec-load-more-button") as HTMLElement | null
        if (!btn) return false
        return window.getComputedStyle(btn).display !== "none"
      })
      if (!visible) break
      await page.click(".mec-load-more-button")
      await new Promise((r) => setTimeout(r, 2500))
    }

    // Build month lookup: data-toggle-divider attribute value -> "Month Year" label
    const monthKeys = await page.evaluate(() => {
      const divs = document.querySelectorAll(".mec-month-divider")
      return Array.from(divs).map((d) => {
        const toggle = d.getAttribute("data-toggle-divider") || ""
        const span = d.querySelector("span")?.textContent || ""
        return { key: toggle, label: span }
      })
    })

    const monthLookup = new Map<string, string>()
    for (const mk of monthKeys) {
      if (mk.key) monthLookup.set(mk.key, mk.label)
    }

    // Extract all event data and resolve their month from CSS class
    const eventsData = await page.evaluate(() => {
      const articles = document.querySelectorAll("article.mec-event-article")
      return Array.from(articles).map((el) => {
        const classes = el.className || ""
        // Toggle key is in a class like "mec-toggle-202607-360"
        const m = classes.match(/mec-toggle-(\d{6})-\d+/)
        const toggleKey = m ? `mec-toggle-${m[1]}-360` : ""
        const eventName =
          el.querySelector("h3.mec-event-title a")?.textContent?.trim() || ""
        const detailUrl =
          el.querySelector("h3.mec-event-title a")?.getAttribute("href") || ""
        const dateText =
          el.querySelector(".mec-start-date-label")?.textContent?.trim() || ""
        const hall =
          el.querySelector(".mec-venue-details span")?.textContent?.trim() || ""
        return { eventName, detailUrl, dateText, hall, toggleKey }
      })
    })

    const events: PhillyExpoCenterEvent[] = []
    for (const r of eventsData) {
      if (!r.eventName) continue

      const monthYear = monthLookup.get(r.toggleKey) || ""
      const { start: eventDateStart, end: eventDateEnd } = parseDate(
        r.dateText,
        monthYear
      )

      events.push({
        eventName: r.eventName,
        eventDateStart,
        eventDateEnd,
        hall: r.hall,
        venue: VENUE_NAME,
        detailUrl: r.detailUrl,
        sourceUrl: CALENDAR_URL,
        sourceSite: "phillyexpocenter.com",
      })
    }

    console.log(`[phillyexpocenter] ${events.length} events parsed`)
    return events
  } finally {
    await browser.close()
  }
}
