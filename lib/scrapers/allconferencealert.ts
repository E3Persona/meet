import puppeteer from "puppeteer-core"
import * as cheerio from "cheerio"

const BASE_URL = "https://allconferencealert.net"

function buildCountryListingUrl(): string {
  return `${BASE_URL}/usa.php`
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
  expectedAttendees: number | null
  sourceSite: "allconferencealert.net"
}

async function getBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
}

async function setHumanHeaders(page: any) {
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function withHardTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Hard timeout (${ms}ms): ${label}`)),
        ms
      )
    ),
  ])
}

async function gotoAndGetStatus(
  page: any,
  url: string,
  timeoutMs = 20000
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try {
    const response = (await withHardTimeout(
      page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }),
      timeoutMs + 5000,
      `goto ${url}`
    )) as { status(): number } | null
    const status = response ? response.status() : null

    // Cloudflare challenge pages often return 403 or 503 with challenge HTML
    if (status === 403 || status === 503) {
      const html = await page.content()
      if (isCloudflareChallenge(html)) {
        console.log(`[ACA] Cloudflare challenge detected (status=${status}), waiting for challenge to complete...`)
        await wait(5000)
        try {
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
        } catch {
          // No subsequent navigation fired — challenge may have resolved in-place
        }
        const newStatus = response.status()
        if (newStatus === 200) {
          return { ok: true, status: 200, error: null }
        }
      }
    }

    const ok = status !== null && status >= 200 && status < 400
    if (!ok) console.warn(`[ACA] Non-OK status ${status} for ${url}`)
    return { ok, status, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ACA] Navigation failed for ${url}: ${message}`)
    return { ok: false, status: null, error: message }
  }
}

function isCloudflareChallenge(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  return (
    text.includes("Just a moment") ||
    text.includes("Enable JavaScript and cookies") ||
    text.includes("Cloudflare")
  )
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

interface RawRow {
  day: number
  month: string
  eventName: string
  eventUrl: string
  venueCity: string
  venueCountry: string
}

// Loads ALL rows for the country-wide listing (60,000+ per the page's own
// hidden #all field), clicking "Load More" until it stops growing or the
// wall-clock budget runs out. Since this is the full USA feed (not a
// per-city page), give it a much larger click ceiling and time budget
// than the old per-city version needed.
async function loadAllRowsAndScrape(
  page: any,
  url: string,
  maxClicks = 2000,
  maxWallClockMs = 20 * 60 * 1000 // 20 minutes — this is a big feed
): Promise<RawRow[]> {
  const nav = await gotoAndGetStatus(page, url)
  if (!nav.ok) {
    console.warn(
      `[ACA] Skipping listing (status=${nav.status}, error=${nav.error}): ${url}`
    )
    return []
  }

  try {
    await withHardTimeout(
      page.waitForSelector("#event-container tr.aevent", { timeout: 15000 }),
      20000,
      `waitForSelector #event-container ${url}`
    )
  } catch {
    console.warn(`[ACA] No event rows appeared on ${url} within 15s`)
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

    if (clicks % 20 === 0) {
      console.log(
        `[ACA] Progress: ${currentCount} rows loaded after ${clicks} clicks`
      )
    }

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
            document.querySelectorAll("#event-container tr.aevent").length >
            prevCount,
          { timeout: 8000 },
          previousCount
        ),
        10000,
        `waitForFunction growth click#${clicks}`
      )
    } catch {
      break
    }

    await wait(600)
  }

  if (Date.now() - startTime >= maxWallClockMs) {
    console.warn(
      `[ACA] Hit ${maxWallClockMs}ms wall-clock budget on ${url} — stopping with what we have (${previousCount} rows)`
    )
  }

  console.log(
    `[ACA] Loaded ${previousCount} total rows after ${clicks} "Load More" clicks`
  )

  return await page.evaluate((baseUrl: string) => {
    const rows: RawRow[] = []
    const trs = Array.from(
      document.querySelectorAll("#event-container tr.aevent")
    ) as HTMLElement[]

    for (const tr of trs) {
      const dayText =
        tr.querySelector(".event-calender-holder h3")?.textContent?.trim() || ""
      const monthText =
        tr.querySelector(".event-calender-holder span")?.textContent?.trim() ||
        ""
      const dayMatch = dayText.match(/(\d+)/)
      const day = dayMatch ? parseInt(dayMatch[1], 10) : NaN

      const nameLink = tr.querySelector("td.name a") as HTMLAnchorElement | null
      const eventName = nameLink?.textContent?.trim().replace(/\s+/g, " ") || ""
      const href = nameLink?.getAttribute("href") || ""
      const eventUrl = href.startsWith("http") ? href : baseUrl + href

      const venueText =
        tr
          .querySelector("td.venue b")
          ?.textContent?.trim()
          .replace(/\s+/g, " ") || ""
      const venueParts = venueText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
      const venueCity = venueParts[0] || ""
      const venueCountry = venueParts[1] || "USA"

      if (!eventName || !href || isNaN(day) || !monthText) continue

      rows.push({
        day,
        month: monthText,
        eventName,
        eventUrl,
        venueCity,
        venueCountry,
      })
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
    console.warn(
      `[ACA] Skipping detail (status=${nav.status}, error=${nav.error}): ${url}`
    )
    return empty
  }

  try {
    await withHardTimeout(
      page.waitForSelector("table.table-bordered", { timeout: 10000 }),
      15000,
      `waitForSelector detail table ${url}`
    )
  } catch {
    const title = await page.title().catch(() => "unknown")
    const bodyLen = await page
      .evaluate(() => document.body?.innerText?.length ?? 0)
      .catch(() => 0)
    console.warn(
      `[ACA] Organizer table missing on ${url} — title="${title}" bodyLen=${bodyLen} (small bodyLen + odd title usually means a Cloudflare challenge)`
    )
    return empty
  }

  // Small delay to let the page's own JS (TypeScript __name helper etc.) settle
  // before Puppeteer's page.evaluate() runs — avoids ReferenceError conflicts.
  await wait(500)

  try {
    return await withHardTimeout(
      page.evaluate(() => {
        // Decodes Cloudflare's email obfuscation. CF replaces a real mailto
        // link with a placeholder (visible text like "[email protected]")
        // and stores the actual address XOR-encoded in a data-cfemail hex
        // string. If CF's own decode script hasn't run (or the challenge
        // blocked full page load), the placeholder is all that's in the DOM
        // — regex-matching the visible text will never find an "@" because
        // there isn't one. This decodes it directly instead of trusting text.
        function decodeCFEmail(encoded: string): string | null {
          try {
            const r = parseInt(encoded.substr(0, 2), 16)
            let email = ""
            for (let n = 2; n < encoded.length; n += 2) {
              const charCode = parseInt(encoded.substr(n, 2), 16) ^ r
              email += String.fromCharCode(charCode)
            }
            return email.includes("@") ? email : null
          } catch {
            return null
          }
        }

        function extractEmailFromCell(cell: HTMLElement): string | null {
          // 1. Cloudflare-obfuscated element takes priority — this is the
          //    actual bug fix. Look for data-cfemail on any descendant,
          //    including the cell itself.
          const cfEl =
            cell.querySelector<HTMLElement>("[data-cfemail]") ??
            (cell.hasAttribute("data-cfemail") ? cell : null)
          if (cfEl) {
            const encoded = cfEl.getAttribute("data-cfemail")
            if (encoded) {
              const decoded = decodeCFEmail(encoded)
              if (decoded) return decoded
            }
          }

          // 2. Real mailto link (non-obfuscated case)
          const mailtoLink = cell.querySelector(
            "a[href^='mailto:']"
          ) as HTMLAnchorElement | null
          if (mailtoLink) {
            return mailtoLink.href
              .replace(/^mailto:/i, "")
              .split("?")[0]
              .trim()
          }

          // 3. Any other link whose href happens to be a mailto
          const anyLink = cell.querySelector("a") as HTMLAnchorElement | null
          if (anyLink?.href?.startsWith("mailto:")) {
            return anyLink.href
              .replace(/^mailto:/i, "")
              .split("?")[0]
              .trim()
          }

          // 4. Plain visible text as last resort — only works when CF's
          //    decode script already ran client-side and replaced the
          //    placeholder with the real address.
          const text = cell.textContent?.trim().replace(/\s+/g, " ") || ""
          const emailMatch = text.match(
            /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
          )
          return emailMatch ? emailMatch[0] : null
        }

        let officialWebsite: string | null = null
        let objective: string | null = null
        let contactPerson: string | null = null
        let organizedBy: string | null = null
        let inquiryEmail: string | null = null

        const rows = Array.from(
          document.querySelectorAll("table.table-bordered tr")
        ) as HTMLElement[]

        for (const tr of rows) {
          const cells = Array.from(tr.querySelectorAll("td")) as HTMLElement[]
          if (cells.length === 0) continue

          if (cells.length === 1 && cells[0].querySelector(".obj")) {
            const fullText =
              cells[0].textContent?.trim().replace(/\s+/g, " ") || ""
            objective =
              fullText.replace(/^Objective of the Conference\s*/i, "").trim() ||
              null
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
            inquiryEmail = extractEmailFromCell(valueCell)
            console.log(
              `[ACA] Event Enquiries cell html: ${valueCell.innerHTML.slice(0, 200)} -> decoded=${inquiryEmail}`
            )
          } else if (label.startsWith("Visit Website")) {
            const link = valueCell.querySelector(
              "a"
            ) as HTMLAnchorElement | null
            officialWebsite = link?.href || null
          }
        }

        return {
          officialWebsite,
          objective,
          contactPerson,
          organizedBy,
          inquiryEmail,
        }
      }),
      15000,
      `evaluate detail ${url}`
    )
  } catch (err) {
    console.warn(`[ACA] page.evaluate failed for ${url}, falling back to cheerio: ${err instanceof Error ? err.message : err}`)
    // Fallback: parse raw HTML with cheerio to avoid Puppeteer scope conflicts
    try {
      const html = await page.content()
      const $ = cheerio.load(html)
      let officialWebsite: string | null = null
      let objective: string | null = null
      let contactPerson: string | null = null
      let organizedBy: string | null = null
      let inquiryEmail: string | null = null

      $("table.table-bordered tr").each((_, tr) => {
        const cells = $(tr).find("td")
        if (cells.length === 0) return

        if (cells.length === 1 && $(cells[0]).find(".obj").length > 0) {
          const fullText = $(cells[0]).text().trim().replace(/\s+/g, " ")
          objective = fullText.replace(/^Objective of the Conference\s*/i, "").trim() || null
          return
        }

        if (cells.length < 2) return

        const label = $(cells[0]).text().trim()
        const valueCell = $(cells[1])
        const value = valueCell.text().trim().replace(/\s+/g, " ")

        if (label.startsWith("Contact Person")) {
          contactPerson = value || null
        } else if (label.startsWith("Organized By")) {
          organizedBy = value || null
        } else if (label.startsWith("Event Enquiries")) {
          // Check for CF-obfuscated email
          const cfEl = valueCell.find("[data-cfemail]").first()
          if (cfEl.length > 0) {
            const encoded = cfEl.attr("data-cfemail")
            if (encoded) {
              try {
                const r = parseInt(encoded.substr(0, 2), 16)
                let email = ""
                for (let n = 2; n < encoded.length; n += 2) {
                  email += String.fromCharCode(parseInt(encoded.substr(n, 2), 16) ^ r)
                }
                if (email.includes("@")) inquiryEmail = email
              } catch { /* ignore */ }
            }
          }
          if (!inquiryEmail) {
            const mailtoLink = valueCell.find("a[href^='mailto:']").first()
            if (mailtoLink.length > 0) {
              inquiryEmail = (mailtoLink.attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0].trim() || null
            }
          }
          if (!inquiryEmail) {
            const plainText = valueCell.text().trim()
            const emailMatch = plainText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
            if (emailMatch) inquiryEmail = emailMatch[0]
          }
          console.log(`[ACA/Cheerio] Event Enquiries: email=${inquiryEmail}`)
        } else if (label.startsWith("Visit Website")) {
          const link = valueCell.find("a").first()
          officialWebsite = link.attr("href") || null
        }
      })

      return { officialWebsite, objective, contactPerson, organizedBy, inquiryEmail }
    } catch (cheerioErr) {
      console.error(`[ACA] Cheerio fallback also failed for ${url}:`, cheerioErr)
      return empty
    }
  }
}

// Normalizes a venueCity string for matching against your target city list,
// e.g. "Las vegas" -> "las vegas", "Washington DC" -> "washington dc".
function normalizeCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, " ")
}

export async function scrapeACA(options?: {
  fetchDetails?: boolean
  yearHint?: number
  // Only rows whose venueCity matches one of these (case-insensitive,
  // whitespace-normalized) get their detail page fetched. Everything else
  // is still returned in the result set but with contact fields left null,
  // so you get the full country listing plus targeted enrichment.
  targetCities?: string[]
}): Promise<ACAEvent[]> {
  const fetchDetails = options?.fetchDetails ?? true
  const yearHint = options?.yearHint ?? new Date().getFullYear()
  const targetCitySet = options?.targetCities
    ? new Set(options.targetCities.map(normalizeCity))
    : null

  const listingUrl = buildCountryListingUrl()

  const browser = await getBrowser()
  const results: ACAEvent[] = []

  try {
    const listingPage = await browser.newPage()
    const detailPage = fetchDetails ? await browser.newPage() : null
    await setHumanHeaders(listingPage)
    if (detailPage) await setHumanHeaders(detailPage)

    console.log(`[ACA] Listing: ${listingUrl}`)

    let rawRows: RawRow[] = []
    try {
      rawRows = await loadAllRowsAndScrape(listingPage, listingUrl)
    } catch (err) {
      console.error(`[ACA] Listing failed entirely for ${listingUrl}:`, err)
      rawRows = []
    }

    if (rawRows.length === 0) {
      console.warn(
        `[ACA] No rows found for ${listingUrl} — returning empty result instead of hanging or crashing.`
      )
    }

    const dates = inferDates(rawRows, yearHint)

    let detailFetchCount = 0
    let skippedCount = 0

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i]
      const eventDate = dates[i]

      let officialWebsite: string | null = null
      let objective: string | null = null
      let contactPerson: string | null = null
      let organizedBy: string | null = null
      let inquiryEmail: string | null = null

      const cityMatches =
        !targetCitySet || targetCitySet.has(normalizeCity(row.venueCity))

      if (detailPage && cityMatches) {
        console.log(
          `[ACA] Detail (in-region): ${row.venueCity} — ${row.eventUrl}`
        )
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
        detailFetchCount++
        await wait(2000)
      } else if (targetCitySet) {
        skippedCount++
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
        expectedAttendees: null,
        sourceSite: "allconferencealert.net",
      })
    }

    if (targetCitySet) {
      console.log(
        `[ACA] Detail pages fetched for ${detailFetchCount} in-region events, skipped ${skippedCount} out-of-region events`
      )
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

export async function checkACAHealth(urls: string[]): Promise<void> {
  const browser = await getBrowser()
  try {
    const page = await browser.newPage()
    for (const url of urls) {
      const nav = await gotoAndGetStatus(page, url)
      console.log(
        `[ACA/Health] ${url} -> status=${nav.status} ok=${nav.ok} error=${nav.error ?? "none"}`
      )
    }
  } finally {
    await browser.close()
  }
}
