// scrapers/asae.ts
import * as cheerio from "cheerio"
import { createJinaProvider } from "../providers/scrape/jina"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"

puppeteer.use(StealthPlugin())

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
  fullDescription: string | null
}

export interface ASAEDetailResult {
  contact: ASAEContact
  fullDescription: string | null
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
    const $root = $card.length ? $card.parent() : $name.closest("div").parent().parent()

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
  // Validates a captured string actually looks like an email before trusting it —
  // guards against grabbing a truncated or artifact-laden mailto capture.
  const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/

  let email: string | null = null

  // 1. Preferred: a real mailto: link, however it survived conversion —
  //    markdown link syntax `(mailto:x@y.com)`, or a bare `mailto:x@y.com`
  //    left in the text.
  const mailtoMatch = markdown.match(/mailto:([^\s)?]+)/i)
  if (mailtoMatch) {
    const candidate = mailtoMatch[1].trim()
    if (EMAIL_PATTERN.test(candidate)) {
      email = candidate.match(EMAIL_PATTERN)![0]
    }
  }

  // 2. Fallback: some converters drop the href entirely and leave only the
  //    visible link text (no "mailto:" anywhere). Scan near a "contact"
  //    keyword first to avoid grabbing an unrelated footer/support email;
  //    fall back to the first email found anywhere on the page if that
  //    scoped search comes up empty.
  if (!email) {
    const contactIdx = markdown.search(/event\s*contact/i)
    if (contactIdx !== -1) {
      const nearby = markdown.slice(contactIdx, contactIdx + 300)
      const nearbyMatch = nearby.match(EMAIL_PATTERN)
      if (nearbyMatch) email = nearbyMatch[0]
    }
    if (!email) {
      const anyMatch = markdown.match(EMAIL_PATTERN)
      if (anyMatch) email = anyMatch[0]
    }
  }

  const phoneMatch = markdown.match(
    /(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/
  )
  const phone = phoneMatch ? phoneMatch[0].trim() : null

  return { organizerEmail: email, organizerPhone: phone }
}

function extractFullDescription(html: string): string | null {
  const $ = cheerio.load(html)

  // Remove scripts, styles, nav, footer, header — keep only main content
  $("script, style, nav, footer, header, .nav, .footer, .header, .sidebar").remove()

  // Try common content selectors first
  const contentSelectors = [
    "article",
    ".event-details",
    ".event-content",
    ".event-description",
    "[class*='description']",
    "[class*='content']",
    "main",
    "#content",
    ".pl-event-details",
  ]

  for (const sel of contentSelectors) {
    const el = $(sel).first()
    if (el.length > 0) {
      const text = el.text().replace(/\s+/g, " ").trim()
      if (text.length > 50) return text
    }
  }

  // Fallback: grab the body text, trimmed
  const bodyText = $("body").text().replace(/\s+/g, " ").trim()
  return bodyText.length > 50 ? bodyText : null
}

function buildOrganizedDescription(html: string): string | null {
  const $ = cheerio.load(html)
  const sections: string[] = []

  // Title
  const title = $("h1").first().text().trim()
  if (title) sections.push(`Event: ${title}`)

  // Date/time
  const dateEl = $("[class*='date'], [class*='time'], time").first()
  if (dateEl.length) {
    const dateText = dateEl.text().trim()
    if (dateText) sections.push(`Date: ${dateText}`)
  }

  // Location/venue
  const venueEl = $("[class*='venue'], [class*='location'], [class*='address']").first()
  if (venueEl.length) {
    const venueText = venueEl.text().trim()
    if (venueText) sections.push(`Location: ${venueText}`)
  }

  // Description / overview
  const descEl = $("[class*='description'], [class*='overview'], [class*='about'], article").first()
  if (descEl.length) {
    const descText = descEl.text().replace(/\s+/g, " ").trim()
    if (descText) sections.push(`Description: ${descText}`)
  }

  // Contact info
  const contactEl = $("[class*='contact'], p.eventcontact").first()
  if (contactEl.length) {
    const contactText = contactEl.text().replace(/\s+/g, " ").trim()
    if (contactText) sections.push(`Contact: ${contactText}`)
  }

  // Speakers / agenda
  const speakersEl = $("[class*='speaker'], [class*='agenda'], [class*='program']")
  speakersEl.each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim()
    if (text) sections.push(text)
  })

  return sections.length > 0 ? sections.join("\n\n") : null
}

export async function scrapeEventContact(
  detailUrl: string,
  browser?: any
): Promise<ASAEDetailResult> {
  const empty: ASAEDetailResult = {
    contact: { organizerEmail: null, organizerPhone: null },
    fullDescription: null,
  }

  // Strategy 1: Puppeteer — ASAE loads contacts via JS, so DOM is the reliable source
  const closeBrowser = !browser
  const pupBrowser = browser ?? await puppeteer.launch({
      headless: true,
      executablePath: "/usr/bin/google-chrome",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    })

  let fullDescription: string | null = null
  let contact: ASAEContact = { organizerEmail: null, organizerPhone: null }

  try {
    const page = await pupBrowser.newPage()
    await page.goto(detailUrl, { waitUntil: "networkidle2", timeout: 30000 })

    // Wait for the contact element to appear (up to 10s)
    try {
      await page.waitForSelector("p.eventcontact, .eventcontact, [class*='contact']", { timeout: 10000 })
    } catch {
      // No contact element — still try parsing what's there
    }

    const html = await page.content()
    await page.close()

    // Build organized description from structured HTML
    fullDescription = buildOrganizedDescription(html)
    console.log(`[ASAE] Description extracted: ${fullDescription ? `${fullDescription.length} chars` : "none"}`)

    // Parse with cheerio for contact info
    const $ = cheerio.load(html)

    // Look for .eventcontact or similar patterns
    const contactEl = $("p.eventcontact").first()
    if (contactEl.length > 0) {
      const contactHtml = contactEl.html() ?? ""
      const contactText = contactEl.text().trim()

      // Extract email
      let email: string | null = null
      const mailtoMatch = contactHtml.match(/mailto:([^\s"'>]+)/i)
      if (mailtoMatch) {
        email = mailtoMatch[1].trim()
      } else {
        const emailMatch = contactText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
        if (emailMatch) email = emailMatch[0]
      }

      // Extract phone
      let phone: string | null = null
      const phoneMatch = contactText.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
      if (phoneMatch) phone = phoneMatch[0].trim()

      contact = { organizerEmail: email, organizerPhone: phone }
      console.log(`[ASAE/Puppeteer] Found contact: email="${email}" phone="${phone}"`)
    } else {
      // Broader search: any mailto link on the page, plus nearby phone
      const anyMailto = $("a[href^='mailto:']").first()
      if (anyMailto.length > 0) {
        const email = (anyMailto.attr("href") ?? "").replace(/^mailto:/i, "").split("?")[0].trim()
        let phone: string | null = null
        const parent = anyMailto.closest("p, div, section, td")
        if (parent.length > 0) {
          const phoneMatch = parent.text().match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
          if (phoneMatch) phone = phoneMatch[0].trim()
        }
        if (!phone) {
          const allText = $.text()
          const phoneMatch = allText.match(/(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)
          if (phoneMatch) phone = phoneMatch[0].trim()
        }
        contact = { organizerEmail: email, organizerPhone: phone }
        console.log(`[ASAE/Puppeteer] Found contact: email="${email}" phone="${phone}"`)
      } else {
        console.log(`[ASAE/Puppeteer] No contact info found on ${detailUrl}`)
      }
    }
  } catch (err) {
    console.error(`[ASAE]   Puppeteer failed for ${detailUrl}:`, err instanceof Error ? err.message : err)
  } finally {
    if (closeBrowser) await pupBrowser.close()
  }

  // Strategy 2: Jina fallback (may catch static content Puppeteer missed)
  if (!contact.organizerEmail && !contact.organizerPhone) {
    try {
      const jina = createJinaProvider()
      const result = await jina.scrape(detailUrl, { timeout: 20000 })
      if (result.markdown) {
        contact = extractContactFromMarkdown(result.markdown)
        // Use Jina markdown as fullDescription if Puppeteer didn't get one
        if (!fullDescription && result.markdown.length > 50) {
          fullDescription = result.markdown
        }
        if (contact.organizerEmail || contact.organizerPhone) {
          console.log(`[ASAE/Jina] Found contact: email="${contact.organizerEmail}" phone="${contact.organizerPhone}"`)
        }
      }
    } catch {
      // ignore
    }
  }

  // If still no description, try Jina even if we have contact
  if (!fullDescription) {
    try {
      const jina = createJinaProvider()
      const result = await jina.scrape(detailUrl, { timeout: 20000 })
      if (result.markdown && result.markdown.length > 50) {
        fullDescription = result.markdown
      }
    } catch {
      // ignore
    }
  }

  return { contact, fullDescription }
}

// ---------- Orchestration ----------

export async function scrapeASAE(options?: {
  skipContacts?: boolean
  maxContactLookups?: number
}): Promise<ASAEEvent[]> {
  const skipContacts = options?.skipContacts ?? false
  const maxContactLookups = options?.maxContactLookups ?? Infinity

  const browser = await puppeteer.launch({
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

  let cards: ASAEEventCard[] = []
  try {
    cards = await scrapeListing(page)
  } catch (err) {
    console.error(`[ASAE] Listing scrape failed:`, err)
  }

  // Keep browser open for contact lookups, close in finally below

  const results: ASAEEvent[] = []
  let lookups = 0

  for (const card of cards) {
    let detail: ASAEDetailResult = {
      contact: { organizerEmail: null, organizerPhone: null },
      fullDescription: null,
    }

    if (!skipContacts && lookups < maxContactLookups) {
      try {
        detail = await scrapeEventContact(card.detailUrl, browser)
      } catch (err) {
        console.error(`[ASAE] Contact lookup error for ${card.detailUrl}:`, err)
      }
      lookups++
      await wait(jitter(1000))
    }

    results.push({
      ...card,
      contact: detail.contact,
      expectedAttendees: null,
      sourceSite: "asaecenter.org",
      fullDescription: detail.fullDescription,
    })
  }

  await browser.close()
  return results
}
