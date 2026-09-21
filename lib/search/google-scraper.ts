import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import * as cheerio from "cheerio"
import {
  type SearchResult,
  parseDateFromText,
  isWithinWindow,
  isValidUrl,
  normalizeUrl,
  dedupeResults,
} from "./search-shared"

puppeteer.use(StealthPlugin())

export interface GoogleScrapeOptions {
  query: string
  pages?: number
  resultsPerPage?: number
  monthsAhead?: number
  timeoutMs?: number
}

// Thrown when Google blocks/captchas the request — signals the caller to
// fall back to Serper rather than treating it as "zero results found".
export class GoogleBlockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GoogleBlockedError"
  }
}

const DEFAULTS = {
  pages: 3,
  resultsPerPage: 10,
  monthsAhead: 3,
  timeoutMs: 20000,
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getBrowser() {
  return puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  })
}

async function setHumanHeaders(page: any) {
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  })
}

function isBlockedPage(html: string): boolean {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
  return (
    text.includes("unusual traffic") ||
    text.includes("recaptcha") ||
    text.includes("/sorry/index") ||
    text.includes("before you continue to google")
  )
}

function buildSearchUrl(
  query: string,
  start: number,
  resultsPerPage: number
): string {
  const params = new URLSearchParams({
    q: query,
    num: String(resultsPerPage),
    start: String(start),
    hl: "en",
    gl: "us",
  })
  return `https://www.google.com/search?${params.toString()}`
}

async function fetchRenderedSerpHtml(
  page: any,
  url: string,
  timeoutMs: number
): Promise<string> {
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: timeoutMs,
  })
  const status = response ? response.status() : null

  // Let results hydrate. If the results container never shows up, we still
  // grab whatever HTML exists so isBlockedPage/parsing can tell us why.
  try {
    await page.waitForSelector("#search", { timeout: 8000 })
  } catch {
    // no #search container within the timeout — fall through, we'll check
    // the html for a block page below
  }

  const html: string = await page.content()

  if (status === 403 || status === 429 || isBlockedPage(html)) {
    throw new GoogleBlockedError(
      `Google blocked/captcha'd request (status=${status}) for ${url}`
    )
  }

  return html
}

function parseSerpHtml(
  html: string,
  page: number,
  monthsAhead: number
): SearchResult[] {
  const $ = cheerio.load(html)
  const results: SearchResult[] = []

  // Anchor on <h3> (result titles) — the most stable element across Google's
  // wrapper-div class churn — then walk up to the nearest real link and out
  // to the nearest block of body text for a snippet.
  $("h3").each((_, h3El) => {
    const $h3 = $(h3El)
    const title = $h3.text().trim()
    if (!title) return

    const $link = $h3.closest("a[href^='http']").length
      ? $h3.closest("a[href^='http']")
      : $h3.parent().find("a[href^='http']").first()
    const href = $link.attr("href")
    if (!href || !isValidUrl(href)) return
    if (/google\.com\/(search|maps|imgres|preferences)/i.test(href)) return

    // Look for a snippet in the nearest reasonable ancestor container —
    // walk up from the h3 a few levels and grab the longest text block that
    // isn't the title itself.
    let snippet: string | null = null
    let $container = $h3.parent()
    for (let i = 0; i < 4 && $container.length; i++) {
      const candidateText = $container
        .find("div, span")
        .filter((_, node) => {
          const t = $(node).text().trim()
          return t.length > 40 && t !== title && !t.includes(title)
        })
        .first()
        .text()
        .trim()
      if (candidateText) {
        snippet = candidateText.slice(0, 400)
        break
      }
      $container = $container.parent()
    }

    const combinedText = `${title} ${snippet ?? ""}`
    const date = parseDateFromText(combinedText)

    // Undated results are rejected — can't honestly claim they're in-window.
    if (!date || !isWithinWindow(date, monthsAhead)) return

    results.push({
      title,
      url: normalizeUrl(href),
      snippet,
      publishedDate: date.toISOString().slice(0, 10),
      page,
      position: results.length + 1,
      eventDate: date.toISOString(),
    })
  })

  return results
}

/**
 * Scrapes Google's own SERP via a real headless Chrome (puppeteer + stealth,
 * same pattern as the ACA scraper) — no paid API involved. Throws
 * GoogleBlockedError if Google serves a captcha/block page, so the caller
 * can fall back to Serper. Returns [] (not a throw) if the page loads fine
 * but nothing in the date window matched — a legitimate "no results", not
 * a failure.
 */
export async function scrapeGoogle(
  opts: GoogleScrapeOptions
): Promise<SearchResult[]> {
  const options = { ...DEFAULTS, ...opts }
  const allResults: SearchResult[] = []

  const browser = await getBrowser()
  try {
    const page = await browser.newPage()
    await setHumanHeaders(page)

    for (let pageNum = 1; pageNum <= options.pages; pageNum++) {
      const start = (pageNum - 1) * options.resultsPerPage
      const url = buildSearchUrl(options.query, start, options.resultsPerPage)

      console.log(
        `[GoogleScrape] "${options.query}" page ${pageNum}/${options.pages}`
      )
      const html = await fetchRenderedSerpHtml(page, url, options.timeoutMs) // throws GoogleBlockedError on block

      const pageResults = parseSerpHtml(html, pageNum, options.monthsAhead)
      allResults.push(...pageResults)

      if (pageNum < options.pages) await wait(1500 + Math.random() * 1500)
    }
  } finally {
    await browser.close()
  }

  return dedupeResults(allResults)
}
