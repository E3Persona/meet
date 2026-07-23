import * as cheerio from "cheerio"

const BASE = "https://rrbitc.com"
const EVENTS_URL = `${BASE}/events-calendar/`
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

export interface RrbitcEvent {
  eventName: string
  eventDateStart: Date | null
  eventDateEnd: Date | null
  startTime: string | null
  endTime: string | null
  locationName: string | null
  locationAddress: string | null
  venue: string | null
  latitude: number | null
  longitude: number | null
  sourceUrl: string
  sourceSite: "rrbitc.com"
}

function extractVenue(locationName: string | null): string | null {
  if (!locationName) return null
  const lower = locationName.toLowerCase()
  if (lower.includes("ronald reagan")) return "Ronald Reagan Building"
  if (lower.includes("reagan")) return "Ronald Reagan Building"
  return locationName
}

const MONTH_MAP: Record<string, number> = {
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

function parseLatLng(raw: string | undefined): {
  lat: number | null
  lng: number | null
} {
  if (!raw) return { lat: null, lng: null }
  const [latStr, lngStr] = raw.split(",").map((s) => s.trim())
  const lat = parseFloat(latStr)
  const lng = parseFloat(lngStr)
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  }
}

/**
 * MEC gives us the start day + month explicitly, but the end day sometimes
 * comes without its own month (e.g. "28jul - 31" all inside July). We prefer
 * the `evo_day` labels inside `.evo_time` when present, since those DO carry
 * a month for both start and end and correctly handle events that cross a
 * month boundary — falling back to the block-level data-smon/data-syr
 * otherwise.
 */
function buildDate(
  day: number,
  monthAbbr: string | null,
  fallbackMonth: string,
  year: number
): Date | null {
  const abbr = (monthAbbr || fallbackMonth || "").toLowerCase().slice(0, 3)
  const mi = MONTH_MAP[abbr]
  if (mi === undefined || !day) return null
  return new Date(Date.UTC(year, mi, day))
}

export async function scrapeRrbitcEvents(): Promise<RrbitcEvent[]> {
  const htmlResp = await fetch(EVENTS_URL, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(30000),
  })
  if (!htmlResp.ok) throw new Error(`HTTP ${htmlResp.status}`)
  const html = await htmlResp.text()

  const $ = cheerio.load(html)
  const seen = new Set<string>()
  const events: RrbitcEvent[] = []

  // MEC repeats the same event across month groupings on some layouts —
  // dedupe on the evc_ id.
  $("a.desc_trig.evcal_list_a").each((_, el) => {
    const $a = $(el)
    const id = $a.attr("id") || ""
    if (id && seen.has(id)) return
    if (id) seen.add(id)

    const $cblock = $a.find(".evcal_cblock").first()
    const smon = $cblock.attr("data-smon") || ""
    const syr = parseInt($cblock.attr("data-syr") || "", 10)

    const $startSpan = $cblock.find(".evo_date .start").first()
    const startDay = parseInt(
      ($startSpan.clone().children().remove().end().text() || "").trim(),
      10
    )
    const startMonthAbbr = $startSpan.find("em").first().text().trim() || null

    const $endSpan = $cblock.find(".evo_date .end").first()
    const endDayMatch = ($endSpan.text() || "").match(/(\d{1,2})/)
    const endDay = endDayMatch ? parseInt(endDayMatch[1], 10) : null

    // evo_day labels (e.g. "jul 28" / "jul 31") give an explicit month per side —
    // more reliable than assuming both ends share data-smon.
    const evoDays = $cblock.find(".evo_time .evo_day")
    const startDayLabel = evoDays.eq(0).text().trim() // "jul 28"
    const endDayLabel = evoDays.length > 1 ? evoDays.eq(1).text().trim() : null // "jul 31"
    const startMonthFromLabel = startDayLabel.split(" ")[0] || null
    const endMonthFromLabel = endDayLabel ? endDayLabel.split(" ")[0] : null

    const eventDateStart = Number.isFinite(startDay)
      ? buildDate(startDay, startMonthFromLabel || startMonthAbbr, smon, syr)
      : null
    const eventDateEnd = endDay
      ? buildDate(endDay, endMonthFromLabel, smon, syr)
      : eventDateStart // single-day event: end == start

    const $desc = $a.find(".evcal_desc").first()
    const eventName = $a.find(".evcal_event_title").first().text().trim()

    const timeText = $a.find(".evcal_time").first().text().trim() // e.g. "8:00 am - 5:00 pm (31)"
    const cleanTime = timeText.replace(/\s*\(\d+\)\s*$/, "")
    const [startTime, endTime] = cleanTime
      .split(/\s*-\s*/)
      .map((s) => s?.trim() || null)

    const locationName = $desc.attr("data-location_name")?.trim() || null
    const locationAddress = $desc.attr("data-location_address")?.trim() || null
    const { lat, lng } = parseLatLng($desc.attr("data-latlng"))

    // MEC list items are usually JS-driven (click opens a popup) rather than
    // a real <a href>. If the href attribute is empty/JS, fall back to an
    // anchor URL built from the event id so you at least have a stable,
    // dereferenceable source reference.
    const rawHref = $a.attr("href")
    const sourceUrl =
      rawHref && !rawHref.startsWith("javascript") && !rawHref.startsWith("#")
        ? new URL(rawHref, BASE).toString()
        : `${EVENTS_URL}#${id}`

    if (!eventName) return // skip malformed entries

    events.push({
      eventName,
      eventDateStart,
      eventDateEnd,
      startTime: startTime || null,
      endTime: endTime === "" ? null : endTime,
      locationName,
      locationAddress,
      venue: extractVenue(locationName),
      latitude: lat,
      longitude: lng,
      sourceUrl,
      sourceSite: "rrbitc.com",
    })
  })

  console.log(`[rrbitc] ${events.length} events parsed`)
  return events
}
