import * as cheerio from "cheerio"
import Tesseract from "tesseract.js"
import sharp from "sharp"

const BASE = "https://www.philadelphiaunion.com"
const EVENTS_URL = `${BASE}/stadium/non-philadelphia-union-events`
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export interface PhiladelphiaUnionEvent {
  eventName: string
  eventDateStart: Date | null
  eventDateEnd: Date | null
  venue: string
  sourceUrl: string
  sourceSite: "philadelphiaunion.com"
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
}
const FALLBACK_YEAR = 2026

function toDesktopUrl(mobileUrl: string): string {
  return mobileUrl.replace("t_keep-aspect-ratio-e-mobile", "t_keep-aspect-ratio-e-desktop")
}

function parseOcrDate(text: string): { start: Date | null; end: Date | null } {
  const clean = text.replace(/[^a-zA-Z0-9\s,-]/g, " ").replace(/\s+/g, " ").trim()

  // "AUGUST 15 16 2026" — range with year (three consecutive numbers after month)
  const m1 = clean.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{4})/)
  if (m1) {
    const mi = MONTH_MAP[m1[1].toLowerCase().slice(0, 3)]
    if (mi !== undefined) return { start: new Date(Date.UTC(+m1[4], mi, +m1[2])), end: new Date(Date.UTC(+m1[4], mi, +m1[3])) }
  }

  // "OCT 13" — single day (must not have another number right after)
  const singlePat = clean.match(/([A-Za-z]{3,9})\s+(\d{1,2})(?:\s[a-zA-Z]|,|\s*$)/)
  if (singlePat) {
    const mi = MONTH_MAP[singlePat[1].toLowerCase().slice(0, 3)]
    if (mi !== undefined && +singlePat[2] <= 31) return { start: new Date(Date.UTC(FALLBACK_YEAR, mi, +singlePat[2])), end: null }
  }

  // "AUGUST 15-16" — range without year (dash or hyphen between numbers)
  const m2 = clean.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s*[-–]\s*(\d{1,2})/)
  if (m2 && +m2[3] <= 31 && +m2[2] !== +m2[3]) {
    const mi = MONTH_MAP[m2[1].toLowerCase().slice(0, 3)]
    if (mi !== undefined) return { start: new Date(Date.UTC(FALLBACK_YEAR, mi, +m2[2])), end: new Date(Date.UTC(FALLBACK_YEAR, mi, +m2[3])) }
  }

  // "AUGUST 15 16" (space separator, no dash) — must have different numbers
  const m2b = clean.match(/([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{1,2})(?:\s|$)/)
  if (m2b && +m2b[3] <= 31 && +m2b[2] !== +m2b[3]) {
    const mi = MONTH_MAP[m2b[1].toLowerCase().slice(0, 3)]
    if (mi !== undefined) return { start: new Date(Date.UTC(FALLBACK_YEAR, mi, +m2b[2])), end: new Date(Date.UTC(FALLBACK_YEAR, mi, +m2b[3])) }
  }

  return { start: null, end: null }
}

function parseOcrVenue(text: string): string {
  const lower = text.toLowerCase().replace(/\n+/g, " ")
  // Known venue names that might appear in images
  const knownVenues = [
    { name: "Subaru Park", patterns: ["subaru park", "subaru", "chester, pa"] },
    { name: "SoulJoel's at Sunnybrook", patterns: ["souljoel", "sunnybrook"] },
    { name: "PPL Park", patterns: ["ppl park"] },
  ]
  for (const v of knownVenues) {
    if (v.patterns.some((p) => lower.includes(p))) return v.name
  }
  return "Subaru Park" // default — all non-Union events are at Subaru Park
}

function altToEventName(alt: string, href: string): string {
  const lower = alt.toLowerCase()
  if (lower.includes("breakaway")) return "Breakaway Philadelphia 2026"
  if (lower.includes("uswnt")) return "USWNT vs Spain"
  if (lower.includes("pll")) return "PLL Philadelphia Waterdogs Homecoming Weekend"
  if (lower.includes("wvss") || lower.includes("wvs")) return "Wrexham vs Sunderland"

  const cleaned = alt.replace(/_\w+_\d+x\d+/g, "").replace(/_\d+x\d+.*/g, "").replace(/\(\d+\)/g, "")
  if (cleaned.length > 3) {
    return cleaned.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim()
  }

  const slug = href.split("/").filter(Boolean).pop() || ""
  const fromSlug = slug.replace(/[-_?&=]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim()
  if (fromSlug.length > 3) return fromSlug

  return alt.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim()
}

export async function scrapePhiladelphiaUnionEvents(): Promise<PhiladelphiaUnionEvent[]> {
  const htmlResp = await fetch(EVENTS_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })
  if (!htmlResp.ok) throw new Error(`HTTP ${htmlResp.status}`)
  const html = await htmlResp.text()

  const $ = cheerio.load(html)
  const leftCol = $("div.d3-l-col__col-9.mls-2-cols-template.left-column").first()
  if (!leftCol.length) throw new Error("Left column not found")

  const entries: { href: string; imgSrc: string; alt: string }[] = []
  leftCol.find(".mls-o-single-photo").each((_, el) => {
    const $el = $(el)
    const href = $el.find("a").first().attr("href") || ""
    if (href.startsWith("/")) return
    entries.push({
      href,
      imgSrc: $el.find("img").first().attr("src") || "",
      alt: $el.find("img").first().attr("alt") || "",
    })
  })

  console.log(`[philadelphiaunion] ${entries.length} event images`)

  const events: PhiladelphiaUnionEvent[] = []

  for (const entry of entries) {
    const desktopUrl = toDesktopUrl(entry.imgSrc)
    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null

    try {
      const resp = await fetch(desktopUrl, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(20000),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const buf = await resp.arrayBuffer()

      const processed = await sharp(Buffer.from(buf))
        .resize(1600, undefined, { fit: "inside", withoutEnlargement: false })
        .grayscale()
        .normalise()
        .sharpen()
        .png()
        .toBuffer()

      const result = await Tesseract.recognize(processed, "eng", { logger: () => {} })
      const ocrText = result.data.text
      const preview = ocrText.slice(0, 200).replace(/\n/g, " | ")
      console.log(`[philadelphiaunion] OCR: "${preview}"`)

      const dates = parseOcrDate(ocrText)
      if (dates.start) {
        eventDateStart = dates.start
        eventDateEnd = dates.end
      }
      const venue = parseOcrVenue(ocrText)
      events.push({
        eventName: altToEventName(entry.alt, entry.href),
        eventDateStart,
        eventDateEnd,
        venue,
        sourceUrl: entry.href,
        sourceSite: "philadelphiaunion.com",
      })
    } catch (err) {
      console.warn(`[philadelphiaunion] OCR failed:`, err)
      events.push({
        eventName: altToEventName(entry.alt, entry.href),
        eventDateStart,
        eventDateEnd,
        venue: "Subaru Park",
        sourceUrl: entry.href,
        sourceSite: "philadelphiaunion.com",
      })
    }
  }

  return events
}
