import puppeteer from "puppeteer-core"

const BASE_URL = "https://allconferencealert.net"

const CITY_SLUG_OVERRIDES: Record<string, string> = {
  "washington dc": "washington",
  washington: "washington",
}

function slugifyCity(cityName: string): string {
  const normalized = cityName.trim().toLowerCase()
  if (CITY_SLUG_OVERRIDES[normalized]) return CITY_SLUG_OVERRIDES[normalized]
  return normalized.replace(/[^a-z0-9]+/g, "")
}

function buildCountryListingUrl(): string {
  return `${BASE_URL}/usa.php`
}

function buildCityListingUrl(citySlug: string): string {
  return `${BASE_URL}/cities/${citySlug}.php`
}

export interface ACAContact {
  contactPerson: string | null
  organizedBy: string | null
  inquiryEmail: string | null
}

export interface ACAEvent {
  eventName: string
  eventDate: string | null
  eventUrl: string
  officialWebsite: string | null
  venueCity: string
  venueCountry: string
  objective: string | null
  contact: ACAContact
  sourceSite: "allconferencealert.net"
}

async function getBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Hard ceiling so a single stuck page (hung network, bad server, etc.)
// can never freeze the whole run, no matter what waitUntil/goto does internally.
function withHardTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Hard timeout (${ms}ms): ${label}`)), ms)
    ),
  ])
}

// Navigates and returns the HTTP status so callers can distinguish
// "page loaded fine but selectors are wrong" from "server errored (500/404/etc)".
async function gotoAndGetStatus(
  page: any,
  url: string,
  timeoutMs = 20000
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const response = await withHardTimeout(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }),
      timeoutMs + 5000,
      `goto ${url}`
    ) as { status(): number } | null
    const status = response ? response.status() : null
    const ok = status !== null && status >= 200 && status < 400
    if (!ok) {
      console.warn(`[ACA] Non-OK status ${status} for ${url}`)
    }
    return { ok, status, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ACA] Navigation failed for ${url}: ${message}`)
    return { ok: false, status: null, error: message }
  }
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}

interface RawRow {
  day: number
  month: string
  eventName: string
  eventUrl: string
  venueCity: string
  venueCountry: string
}

// Clicks "Load More" repeatedly until the row count stops growing or the
// button disappears. Bounded by a max wall-clock budget, not just click count,
// so a stuck AJAX endpoint can't hang this indefinitely.
async function loadAllRowsAndScrape(
  page: any,
  url: string,
  maxClicks = 200,
  maxWallClockMs = 90000
): Promise<RawRow[]> {
  const nav = await gotoAndGetStatus(page, url)
  if (!nav.ok) {
    console.warn(`[ACA] Skipping listing (status=${nav.status}, error=${nav.error}): ${url}`)
    return []
  }

  // Confirm the expected table actually exists before trying to paginate it.
  // If this selector never appears, the site's markup has likely changed
  // (or the real data genuinely never rendered — e.g. its AJAX call failed).
  try {
    await withHardTimeout(
      page.waitForSelector("#event-container tr.aevent", { timeout: 15000 }),
      20000,
      `waitForSelector #event-container ${url}`
    )
  } catch {
    console.warn(`[ACA] No event rows appeared on ${url} within 15s — page markup may not match expected structure, or the site's own data failed to load.`)
    return []
  }

  const startTime = Date.now()
  let previousCount = -1
  let clicks = 0

  while (clicks < maxClicks && Date.now() - startTime < maxWallClockMs) {
    const currentCount = await page.evaluate(
      () => document.querySelectorAll("#event-container tr.aevent").length
    )

    if (currentCount === previousCount) break
    previousCount = currentCount

    const clicked = await page.evaluate(() => {
      const btn = document.querySelector<HTMLButtonElement>("#loadMoreBtn")
      if (!btn) return false
      const style = window.getComputedStyle(btn)
      if (style.display === "none" || btn.disabled) return false
      btn.click()
      return true
    })

    if (!clicked) break
    clicks++

    try {
      await withHardTimeout(
        page.waitForFunction(
          (prevCount: number) =>
            document.querySelectorAll("#event-container tr.aevent").length > prevCount,
          { timeout: 8000 },
          previousCount
        ),
        10000,
        `waitForFunction growth click#${clicks}`
      )
    } catch {
      break
    }

    await wait(800)
  }

  if (Date.now() - startTime >= maxWallClockMs) {
    console.warn(`[ACA] Hit ${maxWallClockMs}ms wall-clock budget while loading rows on ${url} — stopping with what we have.`)
  }

  console.log(`[ACA] Loaded ${previousCount} rows after ${clicks} "Load More" clicks`)

  return await page.evaluate((baseUrl: string) => {
    const rows: RawRow[] = []
    const trs = Array.from(document.querySelectorAll("#event-container tr.aevent")) as HTMLElement[]

    for (const tr of trs) {
      const dayText = tr.querySelector(".event-calender-holder h3")?.textContent?.trim() || ""
      const monthText = tr.querySelector(".event-calender-holder span")?.textContent?.trim() || ""
      const dayMatch = dayText.match(/(\d+)/)
      const day = dayMatch ? parseInt(dayMatch[1], 10) : NaN

      const nameLink = tr.querySelector("td.name a") as HTMLAnchorElement | null
      const eventName = nameLink?.textContent?.trim().replace(/\s+/g, " ") || ""
      const href = nameLink?.getAttribute("href") || ""
      const eventUrl = href.startsWith("http") ? href : baseUrl + href

      const venueText = tr.querySelector("td.venue b")?.textContent?.trim().replace(/\s+/g, " ") || ""
      const venueParts = venueText.split(",").map((s) => s.trim()).filter(Boolean)
      const venueCity = venueParts[0] || ""
      const venueCountry = venueParts[1] || "USA"

      if (!eventName || !href || isNaN(day) || !monthText) continue

      rows.push({ day, month: monthText, eventName, eventUrl, venueCity, venueCountry })
    }

    return rows
  }, BASE_URL)
}

function inferDates(rows: RawRow[], startYear: number): (string | null)[] {
  let currentYear = startYear
  let lastMonthIndex = -1

  return rows.map((row) => {
    const monthIndex = MONTHS[row.month.toLowerCase().slice(0, 3)]
    if (monthIndex === undefined) return null

    if (lastMonthIndex !== -1 && monthIndex < lastMonthIndex) {
      currentYear += 1
    }
    lastMonthIndex = monthIndex

    return new Date(Date.UTC(currentYear, monthIndex, row.day)).toISOString()
  })
}

async function scrapeDetailPage(
  page: any,
  url: string
): Promise<{
  officialWebsite: string | null
  objective: string | null
  contactPerson: string | null
  organizedBy: string | null
  inquiryEmail: string | null
}> {
  const empty = {
    officialWebsite: null,
    objective: null,
    contactPerson: null,
    organizedBy: null,
    inquiryEmail: null,
  }

  const nav = await gotoAndGetStatus(page, url)
  if (!nav.ok) {
    console.warn(`[ACA] Skipping detail (status=${nav.status}, error=${nav.error}): ${url}`)
    return empty
  }

  try {
    return await withHardTimeout(
      page.evaluate(() => {
        let officialWebsite: string | null = null
        let objective: string | null = null
        let contactPerson: string | null = null
        let organizedBy: string | null = null
        let inquiryEmail: string | null = null

        const rows = Array.from(document.querySelectorAll("table.table-bordered tr")) as HTMLElement[]

        for (const tr of rows) {
          const cells = Array.from(tr.querySelectorAll("td")) as HTMLElement[]
          if (cells.length === 0) continue

          if (cells.length === 1 && cells[0].querySelector(".obj")) {
            const fullText = cells[0].textContent?.trim().replace(/\s+/g, " ") || ""
            objective = fullText.replace(/^Objective of the Conference\s*/i, "").trim() || null
            continue
          }

          if (cells.length < 2) continue

          const label = cells[0].textContent?.trim() || ""
          const valueCell = cells[1]
          const value = valueCell.textContent?.trim().replace(/\s+/g, " ") || ""

          if (label.startsWith("Contact Person")) {
            contactPerson = value || null
          } else if (label.startsWith("Organized By")) {
            organizedBy = value || null
          } else if (label.startsWith("Event Enquiries")) {
            const mailtoLink = valueCell.querySelector("a[href^='mailto:']") as HTMLAnchorElement | null
            inquiryEmail = mailtoLink
              ? mailtoLink.href.replace(/^mailto:/i, "").trim()
              : value || null
          } else if (label.startsWith("Visit Website")) {
            const link = valueCell.querySelector("a") as HTMLAnchorElement | null
            officialWebsite = link?.href || null
          }
        }

        return { officialWebsite, objective, contactPerson, organizedBy, inquiryEmail }
      }),
      15000,
      `evaluate detail ${url}`
    )
  } catch (err) {
    console.error(`[ACA] Failed extracting detail fields for ${url}:`, err)
    return empty
  }
}

export async function scrapeACA(options?: {
  mode?: "country" | "city"
  citySlug?: string
  fetchDetails?: boolean
  yearHint?: number
}): Promise<ACAEvent[]> {
  const mode = options?.mode ?? "country"
  const fetchDetails = options?.fetchDetails ?? true
  const yearHint = options?.yearHint ?? new Date().getFullYear()

  const listingUrl =
    mode === "city"
      ? buildCityListingUrl(options?.citySlug ?? "washington")
      : buildCountryListingUrl()

  const browser = await getBrowser()
  const results: ACAEvent[] = []

  try {
    const listingPage = await browser.newPage()
    const detailPage = fetchDetails ? await browser.newPage() : null

    console.log(`[ACA] Listing: ${listingUrl}`)

    let rawRows: RawRow[] = []
    try {
      rawRows = await loadAllRowsAndScrape(listingPage, listingUrl)
    } catch (err) {
      console.error(`[ACA] Listing failed entirely for ${listingUrl}:`, err)
      rawRows = []
    }

    if (rawRows.length === 0) {
      console.warn(`[ACA] No rows found for ${listingUrl} — returning empty result instead of hanging or crashing.`)
    }

    const dates = inferDates(rawRows, yearHint)

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i]
      const eventDate = dates[i]

      let officialWebsite: string | null = null
      let objective: string | null = null
      let contactPerson: string | null = null
      let organizedBy: string | null = null
      let inquiryEmail: string | null = null

      if (detailPage) {
        console.log(`[ACA] Detail: ${row.eventUrl}`)
        try {
          const detail = await scrapeDetailPage(detailPage, row.eventUrl)
          officialWebsite = detail.officialWebsite
          objective = detail.objective
          contactPerson = detail.contactPerson
          organizedBy = detail.organizedBy
          inquiryEmail = detail.inquiryEmail
        } catch (err) {
          console.error(`[ACA] Detail error for ${row.eventUrl}:`, err)
        }
        await wait(2000)
      }

      results.push({
        eventName: row.eventName,
        eventDate,
        eventUrl: row.eventUrl,
        officialWebsite,
        venueCity: row.venueCity,
        venueCountry: row.venueCountry,
        objective,
        contact: { contactPerson, organizedBy, inquiryEmail },
        sourceSite: "allconferencealert.net",
      })
    }

    await listingPage.close()
    if (detailPage) await detailPage.close()
  } finally {
    await browser.close()
  }

  results.sort((a, b) => {
    const at = a.eventDate ? new Date(a.eventDate).getTime() : 0
    const bt = b.eventDate ? new Date(b.eventDate).getTime() : 0
    return at - bt
  })

  return results
}

// Quick standalone health check — run this first against your city list to see,
// per URL, whether you're dealing with a 500, a timeout, or genuinely-missing rows,
// before running a full scrape batch.
export async function checkACAHealth(urls: string[]): Promise<void> {
  const browser = await getBrowser()
  try {
    const page = await browser.newPage()
    for (const url of urls) {
      const nav = await gotoAndGetStatus(page, url)
      console.log(`[ACA/Health] ${url} -> status=${nav.status} ok=${nav.ok} error=${nav.error ?? "none"}`)
    }
  } finally {
    await browser.close()
  }
}