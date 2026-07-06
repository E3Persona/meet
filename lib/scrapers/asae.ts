// scrapers/asae.ts
import * as cheerio from "cheerio"
import { createJinaProvider } from "../providers/scrape/jina"


const ASAE_CALENDAR_URL = "https://www.asaecenter.org/programs/events"
const PHEEDLOOP_EMBED_HOST = "site.pheedloop.com"

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jitter = (base: number) => base + Math.random() * base * 0.5

// ---------- Types ----------

export interface ASAEEventCard {
  eventName: string
  eventMonth: string // raw text, e.g. "May" — no year is shown on the card itself
  eventDay: string // raw text, e.g. "05"
  durationText: string | null // e.g. "150 days" — meaning unconfirmed, see note below
  credits: string | null
  locationText: string | null // e.g. "Session 1: Washington, DC / Session 2: Omaha, NE"
  tags: string[]
  detailUrl: string // e.g. https://events.asaecenter.org/event/EVEOYVMSTUFJU
}

export interface ASAEContact {
  organizerEmail: string | null
  organizerPhone: string | null
}

export interface ASAEEvent extends ASAEEventCard {
  contact: ASAEContact
  expectedAttendees: number | null
  sourceSite: "asaecenter.org"
}

// ---------- Phase 1: Puppeteer against the PheedLoop iframe ----------

async function findPheedloopFrame(
  page: any,
  timeoutMs = 20000
): Promise<any | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const frame = page
      .frames()
      .find((f: any) => f.url().includes(PHEEDLOOP_EMBED_HOST))
    if (frame) return frame
    await wait(500)
  }
  return null
}

// PheedLoop carousels commonly either infinite-scroll or have a "View All" /
// "Load More" control. We handle both defensively: scroll repeatedly, and
// also look for a button whose text matches, clicking it if found.
async function expandAllCards(frame: any, maxIterations = 25): Promise<void> {
  let previousCount = 0
  let stagnantRounds = 0

  for (let i = 0; i < maxIterations; i++) {
    const count = await frame.evaluate(
      () => document.querySelectorAll(".pl-event-name").length
    )

    if (count === previousCount) {
      stagnantRounds++
      if (stagnantRounds >= 3) break
    } else {
      stagnantRounds = 0
    }
    previousCount = count

    const clickedLoadMore = await frame.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button, a")).find(
        (el) => /load more|view all|show more/i.test(el.textContent || "")
      ) as HTMLElement | undefined
      if (btn) {
        btn.click()
        return true
      }
      return false
    })

    await frame.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await wait(clickedLoadMore ? 1500 : 800)
  }
}

function parseCardsFromHtml(html: string): ASAEEventCard[] {
  const $ = cheerio.load(html)
  const cards: ASAEEventCard[] = []

  $(".pl-event-name").each((_, nameEl) => {
    const $name = $(nameEl)
    // Walk up to the card container (the flex row wrapper from your sample)
    const $card = $name
      .closest("div.flex.flex-col.items-start, div.flex.w-full")
      .parent()
    const $root = $card.length ? $card : $name.closest("div").parent()

    const eventName = $name.text().trim()
    const eventMonth = $root.find(".pl-event-month").first().text().trim()
    const eventDay = $root.find(".pl-event-day").first().text().trim()

    const durationText =
      $root.find(".pl-event-duration span").first().text().trim() || null
    const credits =
      $root.find(".pl-event-credits span").first().text().trim() || null
    const locationText =
      $root.find(".pl-event-location span").first().text().trim() || null

    const tags = $root
      .find(".pl-tag")
      .map((_, t) => $(t).text().trim())
      .get()
      .filter(Boolean)

    const detailUrl =
      $root.find(".pl-event-link").first().attr("href")?.trim() || ""

    if (!eventName || !detailUrl) return

    cards.push({
      eventName,
      eventMonth,
      eventDay,
      durationText,
      credits,
      locationText,
      tags,
      detailUrl,
    })
  })

  return cards
}

async function scrapeListing(page: any): Promise<ASAEEventCard[]> {
  await page.goto(ASAE_CALENDAR_URL, {
    waitUntil: "networkidle2",
    timeout: 30000,
  })
  await wait(2000)

  const frame = await findPheedloopFrame(page)
  if (!frame) {
    console.warn(`[ASAE] Could not locate the PheedLoop embed iframe`)
    return []
  }

  try {
    await frame.waitForSelector(".pl-event-name", { timeout: 15000 })
  } catch {
    console.warn(`[ASAE] Cards never appeared in the PheedLoop frame`)
    return []
  }

  await expandAllCards(frame)

  const html: string = await frame.content()
  const cards = parseCardsFromHtml(html)

  // De-dupe by detail URL in case scroll/load-more re-rendered overlapping cards
  const seen = new Set<string>()
  return cards.filter((c) => {
    if (seen.has(c.detailUrl)) return false
    seen.add(c.detailUrl)
    return true
  })
}

// ---------- Phase 2: organizer contact via Jina against the detail page ----------

function extractContactFromMarkdown(markdown: string): ASAEContact {
  // Prefer the mailto: link — most reliable signal, matches your sample's
  // <p class="eventcontact"><a href="mailto:...">
  const mailtoMatch = markdown.match(/mailto:([^\s)?]+)/i)
  const email = mailtoMatch ? mailtoMatch[1].trim() : null

  const phoneMatch = markdown.match(
    /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  )
  const phone = phoneMatch ? phoneMatch[0].trim() : null

  return { organizerEmail: email, organizerPhone: phone }
}

export async function scrapeEventContact(
  detailUrl: string
): Promise<ASAEContact> {
  const jina = createJinaProvider()
  const result = await jina.scrape(detailUrl, { timeout: 20000 })

  if (!result.markdown) {
    console.warn(
      `[ASAE]   ✗ no markdown returned for ${detailUrl}: ${result.error}`
    )
    return { organizerEmail: null, organizerPhone: null }
  }

  const contact = extractContactFromMarkdown(result.markdown)
  if (!contact.organizerEmail && !contact.organizerPhone) {
    console.warn(`[ASAE]   ✗ no contact found on detail page: ${detailUrl}`)
  }
  return contact
}

// ---------- Orchestration ----------

export async function scrapeASAE(options?: {
  skipContacts?: boolean
  maxContactLookups?: number
}): Promise<ASAEEvent[]> {
  const skipContacts = options?.skipContacts ?? false
  const maxContactLookups = options?.maxContactLookups ?? Infinity

  const { launch: launchBrowser } = await import("puppeteer-core")

  const browser = await launchBrowser({
    headless: true,
    executablePath: "/usr/bin/google-chrome",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1920,1080",
    ],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  )

  let cards: ASAEEventCard[] = []
  try {
    cards = await scrapeListing(page)
  } finally {
    await browser.close()
  }

  const results: ASAEEvent[] = []
  let lookups = 0

  for (const card of cards) {
    let contact: ASAEContact = { organizerEmail: null, organizerPhone: null }

    if (!skipContacts && lookups < maxContactLookups) {
      try {
        contact = await scrapeEventContact(card.detailUrl)
      } catch (err) {
        console.error(`[ASAE] Contact lookup error for ${card.detailUrl}:`, err)
      }
      lookups++
      await wait(jitter(1000))
    }

    results.push({ ...card, contact, expectedAttendees: null, sourceSite: "asaecenter.org" })
  }

  return results
}
