import "dotenv/config"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import * as cheerio from "cheerio"
import { writeFileSync } from "fs"

puppeteer.use(StealthPlugin())

/*
 * Fetches one Google SERP page with a real headless Chrome (same pattern
 * as lib/google-scraper.ts), saves the rendered HTML to disk, and prints a
 * structural summary so we can see what we're actually working with —
 * instead of guessing selectors against assumed markup.
 *
 * Usage:
 *   npx tsx scripts/debug-google-scrape.ts "Delaware tradeshow september"
 */

const query = process.argv[2]?.trim()
if (!query) {
  console.error('Usage: npx tsx scripts/debug-google-scrape.ts "search phrase"')
  process.exit(1)
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

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

async function main() {
  const params = new URLSearchParams({
    q: query,
    num: "10",
    start: "0",
    hl: "en",
    gl: "us",
  })
  const url = `https://www.google.com/search?${params.toString()}`

  console.log(`[Debug] Launching headless Chrome...`)
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  })

  try {
    const page = await browser.newPage()
    await page.setExtraHTTPHeaders({
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    })

    console.log(`[Debug] Fetching: ${url}\n`)
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    })
    const status = response ? response.status() : null
    console.log(`[Debug] HTTP status: ${status}`)

    let waitedForSearch = true
    try {
      await page.waitForSelector("#search", { timeout: 8000 })
    } catch {
      waitedForSearch = false
      console.log(
        `[Debug] #search container did not appear within 8s — grabbing HTML anyway`
      )
    }
    console.log(`[Debug] #search appeared before timeout: ${waitedForSearch}`)

    const html: string = await page.content()
    console.log(`[Debug] Response bytes: ${html.length}`)

    writeFileSync("/tmp/google-serp-debug.html", html, "utf-8")
    console.log(`[Debug] Saved rendered HTML to /tmp/google-serp-debug.html\n`)

    const flags = {
      blockedPage: isBlockedPage(html),
      consentWall: html.toLowerCase().includes("consent.google.com"),
      noscript: html.toLowerCase().includes("<noscript") && html.length < 20000,
    }
    console.log("[Debug] Page-type flags:", flags)

    const $ = cheerio.load(html)
    console.log(`\n[Debug] <title>: ${$("title").text()}`)

    const candidateSelectors = [
      "#search",
      "div.g",
      "div.tF2Cxc",
      "div.MjjYud",
      "div[data-hveid]",
      "div.Gx5Zad",
      "div.kvH3mc",
      "a[jsname]",
      "h3",
    ]
    console.log("\n[Debug] Selector hit counts:")
    for (const sel of candidateSelectors) {
      console.log(`  ${sel.padEnd(20)} → ${$(sel).length}`)
    }

    console.log("\n[Debug] First 5 <h3> elements + nearest link href:")
    $("h3")
      .slice(0, 5)
      .each((i, el) => {
        const $el = $(el)
        const text = $el.text().trim()
        const href =
          $el.closest("a[href^='http']").attr("href") ||
          $el.parent().find("a[href^='http']").first().attr("href") ||
          "(no href found)"
        console.log(`  [${i}] "${text}" → ${href}`)
      })

    console.log(
      "\n[Debug] Done. Open /tmp/google-serp-debug.html in a browser or editor to inspect manually."
    )
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error("[Debug] Fatal:", err)
  process.exit(1)
})
