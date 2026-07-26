export interface BigEventEvent {
  id: string
  name: string
  date: string
  location: string
  venue: string
  format: string
  attendees: string
  speakers: string
  exhibitors: string
  bestFor: string
  topics: string
  why: string
  website: string
  sourceSite: "bigevent.io"
  eventDateStart: string | null
  eventDateEnd: string | null
  city: string | null
  country: string | null
}

interface CompareData {
  id: string
  name: string
  date: string
  location: string
  venue: string
  format: string
  attendees: string
  speakers: string
  exhibitors: string
  bestFor: string
  topics: string
  why: string
  website: string
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
}

function parseBigEventDate(raw: string): { start: Date | null; end: Date | null } {
  const trimmed = raw.trim()
  const dashRe = /–|—|-/
  const parts = trimmed.split(dashRe)

  if (parts.length < 2) {
    const d = new Date(trimmed)
    return isNaN(d.getTime()) ? { start: null, end: null } : { start: d, end: null }
  }

  const left = parts[0].trim()
  const right = parts[1].trim()

  const leftM = left.match(/^([A-Za-z]+)\s+(\d{1,2})$/)
  const rightM = right.match(/^([A-Za-z]+)?\s*(\d{1,2}),\s*(\d{4})$/)
  if (!leftM || !rightM) return { start: null, end: null }

  const startMonth = MONTHS[leftM[1].toLowerCase()]
  const startDay = parseInt(leftM[2])
  const endMonth = rightM[1] ? MONTHS[rightM[1].toLowerCase()] : startMonth
  const endDay = parseInt(rightM[2])
  const year = parseInt(rightM[3])

  if (startMonth === undefined || endMonth === undefined || isNaN(startDay) || isNaN(endDay) || isNaN(year)) {
    return { start: null, end: null }
  }

  return {
    start: new Date(year, startMonth, startDay),
    end: new Date(year, endMonth, endDay),
  }
}

function parseLocation(location: string): { city: string | null; country: string | null } {
  const parts = location.split(",").map((s) => s.trim()).filter(Boolean)
  if (parts.length >= 2) {
    return { city: parts[0], country: parts[parts.length - 1] }
  }
  return { city: parts[0] ?? null, country: null }
}

function extractEventsFromPage(): CompareData[] {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[data-compare]')
  const results: CompareData[] = []
  for (const input of inputs) {
    const raw = input.getAttribute("data-compare")
    if (!raw) continue
    const parsed = JSON.parse(raw) as CompareData
    if (parsed.id && parsed.name) results.push(parsed)
  }
  return results
}

function hasLoadMore(): boolean {
  return !!document.querySelector('.be-load-more, .be-load-more__btn, [class*="load-more"], [class*="load_more"]')
}

function clickLoadMore(): void {
  const btn = document.querySelector<HTMLElement>(
    '.be-load-more, .be-load-more__btn, [class*="load-more"], [class*="load_more"]'
  )
  if (btn) btn.click()
}

export async function createBigEventBrowser() {
  const puppeteerExtra = (await import("puppeteer-extra")).default
  const stealthPlugin = (await import("puppeteer-extra-plugin-stealth")).default
  puppeteerExtra.use(stealthPlugin())
  return await puppeteerExtra.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  })
}

export async function scrapeBigEventEvents(page: any): Promise<BigEventEvent[]> {
  const url = "https://bigevent.io/events/"
  console.log(`[bigevent] Loading ${url}...`)

  await page.goto(url, {
    waitUntil: "networkidle2",
    timeout: 60000,
  })
  await new Promise((r) => setTimeout(r, 3000))

  const hasLoadMoreBtn = await page.evaluate(hasLoadMore)
  if (hasLoadMoreBtn) {
    console.log("[bigevent] Found 'Load More' button, clicking...")
    let previousCount = 0
    for (let i = 0; i < 50; i++) {
      await page.evaluate(clickLoadMore)
      await new Promise((r) => setTimeout(r, 2000))
      const count = await page.evaluate(() => document.querySelectorAll('input[data-compare]').length)
      if (count === previousCount) break
      previousCount = count
      console.log(`[bigevent] Load more click ${i + 1}: ${count} events loaded`)
    }
  }

  const compareData = await page.evaluate(extractEventsFromPage)
  console.log(`[bigevent] Extracted ${compareData.length} raw event cards`)

  const events: BigEventEvent[] = []

  for (const cd of compareData) {
    const { start, end } = parseBigEventDate(cd.date)
    const { city, country } = parseLocation(cd.location)

    events.push({
      id: cd.id,
      name: cd.name,
      date: cd.date,
      location: cd.location,
      venue: cd.venue,
      format: cd.format,
      attendees: cd.attendees,
      speakers: cd.speakers,
      exhibitors: cd.exhibitors,
      bestFor: cd.bestFor,
      topics: cd.topics,
      why: cd.why,
      website: cd.website,
      sourceSite: "bigevent.io",
      eventDateStart: start ? start.toISOString() : null,
      eventDateEnd: end ? end.toISOString() : null,
      city,
      country,
    })
  }

  return events
}
