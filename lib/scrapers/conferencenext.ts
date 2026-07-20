import puppeteer from "puppeteer-core"

const BASE_URL = "https://conferencenext.com"

// Per-city slug map — site has dedicated city pages, much faster than filtering
const TARGET_CITY_SLUGS: Record<
  string,
  { city: string; state: string | null }
> = {
  augusta: { city: "Augusta", state: "GA" },
  austin: { city: "Austin", state: "TX" },
  boston: { city: "Boston", state: "MA" },
  california: { city: "California", state: "CA" }, // state-level page, not a single city
  chicago: { city: "Chicago", state: "IL" },
  columbus: { city: "Columbus", state: "OH" },
  dallas: { city: "Dallas", state: "TX" },
  denver: { city: "Denver", state: "CO" },
  florida: { city: "Florida", state: "FL" }, // state-level page
  hawaii: { city: "Hawaii", state: "HI" }, // state-level page
  "las-vegas": { city: "Las Vegas", state: "NV" },
  "los-angeles": { city: "Los Angeles", state: "CA" },
  miami: { city: "Miami", state: "FL" },
  "new-york": { city: "New York", state: "NY" },
  philadelphia: { city: "Philadelphia", state: "PA" },
  phoenix: { city: "Phoenix", state: "AZ" },
  "san-antonio": { city: "San Antonio", state: "TX" },
  "san-diego": { city: "San Diego", state: "CA" },
  "san-francisco": { city: "San Francisco", state: "CA" },
  seattle: { city: "Seattle", state: "WA" },
  texas: { city: "Texas", state: "TX" }, // state-level page
  "washington-dc": { city: "Washington DC", state: "DC" },
}

const CITY_TO_CN_SLUG: Record<string, string> = {}
for (const [slug, meta] of Object.entries(TARGET_CITY_SLUGS)) {
  const key = `${meta.city}|${meta.state ?? ""}`.toLowerCase()
  CITY_TO_CN_SLUG[key] = slug
}

export function cityToCnSlug(city: string, state: string): string | null {
  const key = `${city}|${state}`.toLowerCase()
  if (CITY_TO_CN_SLUG[key]) return CITY_TO_CN_SLUG[key]
  if (CITY_TO_CN_SLUG[`${city}|`]) return CITY_TO_CN_SLUG[`${city}|`]
  return null
}

export interface CNContact {
  organizerName: string | null
  organizerOrg: string | null
  organizerEmail: string | null
  organizerPhone: null // site never exposes phone numbers
  organizerLinkedIn: null
}

export interface CNEvent {
  eventName: string
  eventAcronym: string | null
  eventType: string | null
  eventDateStart: string // ISO datetime
  eventDateEnd: string | null // ISO datetime
  eventUrl: string
  officialWebsite: string | null // the outbound link — organizer's own site
  venueFullName: null // site never lists hotel/venue name
  venueAddress: null // site never lists street address
  venueCity: string
  venueState: string | null
  venueCountry: string
  contacts: CNContact[]
  indexedIn: string[]
  expectedAttendees: number | null
  sourceSite: "conferencenext.com"
}

function buildListingUrl(citySlug: string, page: number): string {
  // e.g. /conferences/philadelphia?page=2
  return `${BASE_URL}/conferences/${citySlug}${page > 1 ? `?page=${page}` : ""}`
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

function isCloudflareChallenge(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  return (
    text.includes("Just a moment") ||
    text.includes("Enable JavaScript and cookies") ||
    text.includes("Cloudflare")
  )
}

// Decode Cloudflare email obfuscation (fallback only — most events show plain email in .descr)
function decodeCFEmail(encoded: string): string {
  let email = ""
  const r = parseInt(encoded.slice(0, 2), 16)
  for (let n = 2; n < encoded.length; n += 2) {
    email += String.fromCharCode(parseInt(encoded.slice(n, n + 2), 16) ^ r)
  }
  return email
}

// Extract acronym from title — e.g. "... (ICNLPM)" → "ICNLPM"
function extractAcronym(title: string): string | null {
  const match = title.match(/\(([A-Z0-9\-]+)\)\s*$/)
  return match ? match[1] : null
}

interface RawCard {
  name: string
  url: string
  venueText: string
  startDate: string // ISO, from content attr
  endDate: string | null // ISO, from content attr
}

async function withRetry(fn: () => Promise<void>, label: string, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { await fn(); return } catch {
      if (attempt < retries - 1) await wait(3000)
      else throw new Error(`Failed: ${label}`)
    }
  }
}

async function scrapeListingPage(
  page: any,
  url: string
): Promise<{ cards: RawCard[]; hasNext: boolean }> {
  await withRetry(async () => {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    if (resp && (resp.status() === 403 || resp.status() === 503)) {
      const html = await page.content()
      if (isCloudflareChallenge(html)) {
        console.log(`[CN] Cloudflare challenge on listing (status=${resp.status()}), waiting...`)
        await wait(10000)
        try {
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
        } catch { /* challenge may have resolved in-place */ }
        const htmlAfter = await page.content()
        if (!isCloudflareChallenge(htmlAfter)) {
          console.log(`[CN] Challenge resolved for listing`)
        }
      }
    }
  }, `listing ${url}`)

  const result = await page.evaluate(() => {
    const cards: RawCard[] = []
    const seen = new Set<string>()

    // Each event card is <a itemtype="http://schema.org/Event" href="https://...">
    const anchors = Array.from(
      document.querySelectorAll('a[itemtype="http://schema.org/Event"]')
    ) as HTMLAnchorElement[]

    anchors.forEach((a) => {
      const href = a.getAttribute("href") || ""
      if (!href || seen.has(href)) return
      seen.add(href)

      const name =
        a.querySelector(".e_name")?.textContent?.trim().replace(/\s+/g, " ") ||
        ""

      const venueText =
        a
          .querySelector('.e_venue [itemprop="address"]')
          ?.textContent?.trim()
          .replace(/\s+/g, " ") || ""

      // ISO datetime lives in the `content` attribute, not the visible text
      // (visible text is just "02 Jul" with no year)
      const startDate =
        a.querySelector('[itemprop="startDate"]')?.getAttribute("content") || ""
      const endDate =
        a.querySelector('[itemprop="endDate"]')?.getAttribute("content") || null

      if (!name || !startDate) return

      // href is already an absolute URL on this site
      cards.push({ name, url: href, venueText, startDate, endDate })
    })

    const pageLinks = Array.from(
      document.querySelectorAll('a[href*="?page="]')
    ) as HTMLAnchorElement[]
    const hasNext = pageLinks.length > 0

    return { cards, hasNext }
  })

  return result
}

interface CNDetailResult {
  officialWebsite: string | null
  organizerName: string | null
  organizerOrg: string | null
  organizerEmail: string | null
  indexedIn: string[]
}

async function scrapeDetailPage(
  page: any,
  url: string
): Promise<Partial<CNDetailResult>> {
  await withRetry(async () => {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
    if (resp && (resp.status() === 403 || resp.status() === 503)) {
      const html = await page.content()
      if (isCloudflareChallenge(html)) {
        console.log(`[CN] Cloudflare challenge on detail (status=${resp.status()}), waiting...`)
        await wait(10000)
        try {
          await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 })
        } catch { /* challenge may have resolved in-place */ }
        const htmlAfter = await page.content()
        if (!isCloudflareChallenge(htmlAfter)) {
          console.log(`[CN] Challenge resolved for detail`)
        }
      }
    }
  }, `detail ${url}`)

  return await page.evaluate(
    (decodeFnBody: string) => {
      const decode = new Function("encoded", decodeFnBody) as (
        e: string
      ) => string

      // --- Official website ("Visit Website" outbound button) ---
      const attendLink = document.querySelector(
        'a[data-cta="outbound"]'
      ) as HTMLAnchorElement | null
      const officialWebsite = attendLink?.href || null

      // --- Organizer details ---
      // Structure: <li><div class="title">Label:</div><div class="descr">Value</div></li>
      let organizerOrg: string | null = null
      let organizerName: string | null = null
      let organizerEmail: string | null = null

      const items = Array.from(
        document.querySelectorAll(".event-body li")
      ) as HTMLElement[]

      for (const li of items) {
        const title = li.querySelector(".title")?.textContent?.trim() || ""
        const descr =
          li
            .querySelector(".descr")
            ?.textContent?.trim()
            .replace(/\s+/g, " ") || ""

        if (title.startsWith("Conference Organized By")) {
          organizerOrg = descr || null
        } else if (title.startsWith("Conference Contact Person")) {
          organizerName = descr || null
        } else if (title.startsWith("Conference Inquiry Email")) {
          organizerEmail = descr || null
        }
      }

      // Fallback: some events may obfuscate email via mailto or CF data-cfemail
      if (!organizerEmail) {
        const mailtoLink = document.querySelector(
          'a[href^="mailto:"]'
        ) as HTMLAnchorElement | null
        if (mailtoLink) {
          organizerEmail = mailtoLink.href.replace("mailto:", "").trim() || null
        } else {
          const cfEl = document.querySelector("[data-cfemail]")
          if (cfEl) {
            const encoded = cfEl.getAttribute("data-cfemail") || ""
            if (encoded) organizerEmail = decode(encoded)
          }
        }
      }

      // --- Indexed-in logos (best-effort — no confirmed markup sample yet) ---
      const indexedImages = Array.from(
        document.querySelectorAll(".indexed-in img, [class*='index'] img")
      ) as HTMLImageElement[]
      const indexedIn = indexedImages
        .map((img) => img.alt?.trim())
        .filter((v): v is string => Boolean(v))

      return {
        officialWebsite,
        organizerOrg,
        organizerName,
        organizerEmail,
        indexedIn,
      }
    },
    `
    let email = "";
    const r = parseInt(encoded.slice(0, 2), 16);
    for (let n = 2; n < encoded.length; n += 2) {
      email += String.fromCharCode(parseInt(encoded.slice(n, n + 2), 16) ^ r);
    }
    return email;
  `
  )
}

function parseVenueText(venueText: string): { city: string; country: string } {
  // Format: "Los Angeles, USA"
  const parts = venueText.split(",").map((p) => p.trim())
  return {
    city: parts[0] || venueText,
    country: parts[1] || "USA",
  }
}

export async function scrapeCN(options?: {
  citySlugs?: string[]
  maxPagesPerCity?: number
  skipDetailPages?: boolean // when true, does not follow detail pages (no contacts extracted)
  maxDetailPages?: number // cap on how many detail pages to visit
}): Promise<CNEvent[]> {
  const slugsToScrape = options?.citySlugs || Object.keys(TARGET_CITY_SLUGS)
  const maxPages = options?.maxPagesPerCity ?? 999
  const skipDetails = options?.skipDetailPages ?? false
  const maxDetail = options?.maxDetailPages ?? Infinity

  const browser = await getBrowser()
  const results: CNEvent[] = []
  const seenUrls = new Set<string>()
  let detailsVisited = 0

  try {
    const listingPage = await browser.newPage()
    const detailPage = skipDetails ? null : await browser.newPage()
    await setHumanHeaders(listingPage)
    if (detailPage) await setHumanHeaders(detailPage)

    for (const slug of slugsToScrape) {
      const cityMeta = TARGET_CITY_SLUGS[slug] || { city: slug, state: null }
      let pageNum = 1
      let keepGoing = true

      while (keepGoing && pageNum <= maxPages) {
        const url = buildListingUrl(slug, pageNum)
        console.log(`[CN] Listing: ${url}`)

        const { cards, hasNext } = await scrapeListingPage(listingPage, url)

        if (cards.length === 0) {
          keepGoing = false
          break
        }

        for (const card of cards) {
          if (seenUrls.has(card.url)) continue
          seenUrls.add(card.url)

          const { city, country } = parseVenueText(card.venueText)
          const acronym = extractAcronym(card.name)

          let detail: Partial<CNDetailResult> = {}
          if (detailPage && detailsVisited < maxDetail) {
            console.log(`[CN] Detail: ${card.url}`)
            try {
              detail = await scrapeDetailPage(detailPage, card.url)
              detailsVisited++
            } catch (err) {
              console.error(`[CN] Detail error for ${card.url}:`, err)
            }
            await wait(2000)
          }

          results.push({
            eventName: card.name.replace(/\s*\([A-Z0-9\-]+\)\s*$/, "").trim(),
            eventAcronym: acronym,
            eventType: "Conference",
            eventDateStart: card.startDate,
            eventDateEnd: card.endDate,
            eventUrl: card.url,
            officialWebsite: detail.officialWebsite || null,
            venueFullName: null,
            venueAddress: null,
            venueCity: city,
            venueState: cityMeta.state,
            venueCountry: country,
            contacts: [
              {
                organizerName: detail.organizerName || null,
                organizerOrg: detail.organizerOrg || null,
                organizerEmail: detail.organizerEmail || null,
                organizerPhone: null,
                organizerLinkedIn: null,
              },
            ],
            indexedIn: detail.indexedIn || [],
            expectedAttendees: null,
            sourceSite: "conferencenext.com",
          })
        }

        keepGoing = hasNext
        pageNum++
        await wait(1500) // between listing pages
      }
    }

    await listingPage.close()
    if (detailPage) await detailPage.close()
  } finally {
    await browser.close()
  }

  // Chronological sort — hard requirement
  results.sort(
    (a, b) =>
      new Date(a.eventDateStart).getTime() -
      new Date(b.eventDateStart).getTime()
  )

  return results
}
