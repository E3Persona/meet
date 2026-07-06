import * as cheerio from "cheerio"

const BASE = "https://www.blackmeetingsandtourism.com"
const CURRENT_EVENTS_URL = `${BASE}/News-Center/Business-Exclusives/Current-Events.aspx`
const FACILITIES_UPDATE_URL = `${BASE}/News-Center/Business-Exclusives/Facilities-Update.aspx`
const CONVENTION_CENTERS_URL = `${BASE}/pages/Meetings-Conventions.aspx`

export interface BMEventCard {
  title: string
  detailUrl: string | null
  dateCategory: string | null
  section: "current-events" | "facilities-update"
  previewText: string | null
}

export interface BMContact {
  name: string
  phone: string | null
  email: string | null
}

export interface BMEvent extends BMEventCard {
  bodyText: string | null
  eventName: string | null
  venueName: string | null
  venueLocation: string | null
  eventDateStart: Date | null
  eventDateEnd: Date | null
  contacts: BMContact[]
  externalLinks: string[]
  expectedAttendees: number | null
  sourceSite: "blackmeetingsandtourism.com"
}

export interface BMVenue {
  name: string
  detailUrl: string | null
  description: string | null
  totalExhibitSpace: string | null
  largestBallroom: string | null
  meetingRooms: string | null
  contactName: string | null
  contactPhone: string | null
  website: string | null
  sourceSite: "blackmeetingsandtourism.com"
}

export interface ScrapeBMOptions {
  maxDetailPages?: number
  skipDetailPages?: boolean
  sections?: ("current-events" | "facilities-update")[]
}

function resolveUrl(href: string | null | undefined): string | null {
  if (!href) return null
  try {
    return new URL(href, BASE).toString()
  } catch {
    return null
  }
}

function htmlToText(html: string): string {
  return cheerio.load(`<div>${html}</div>`)("div").text().replace(/\s+/g, " ").trim()
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function fetchWithRetry(url: string, attempts = 3): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (err) {
      if (attempt < attempts - 1) await delay(2000)
      else throw err
    }
  }
  throw new Error(`Failed to fetch after ${attempts} attempts`)
}

function parseEventDates(text: string): { start: Date | null; end: Date | null } {
  const monthNames = ["january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"]

  const lc = text.toLowerCase()

  const monthPattern = `(${monthNames.join("|")})`
  const dateRangeRegex = new RegExp(
    `${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*(-|–|to)\\s*(?:${monthPattern}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})`,
    "gi"
  )
  const singleDateRegex = new RegExp(
    `${monthPattern}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(\\d{4})`,
    "gi"
  )

  const rangeMatch = dateRangeRegex.exec(lc)
  if (rangeMatch) {
    const m1 = rangeMatch[1]
    const d1 = parseInt(rangeMatch[2])
    const m2 = rangeMatch[3] || m1
    const d2 = parseInt(rangeMatch[4])
    const year = parseInt(rangeMatch[5])
    const start = new Date(`${m1} ${d1}, ${year}`)
    const end = new Date(`${m2} ${d2}, ${year}`)
    return {
      start: isNaN(start.getTime()) ? null : start,
      end: isNaN(end.getTime()) ? null : end,
    }
  }

  const singleMatch = singleDateRegex.exec(lc)
  if (singleMatch) {
    const m = singleMatch[1]
    const d = parseInt(singleMatch[2])
    const year = parseInt(singleMatch[3])
    const date = new Date(`${m} ${d}, ${year}`)
    return {
      start: isNaN(date.getTime()) ? null : date,
      end: null,
    }
  }

  return { start: null, end: null }
}

function extractContacts(text: string): BMContact[] {
  const contacts: BMContact[] = []
  const seen = new Set<string>()

  const textOnly = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

  // Pattern 1: "Contact Name at (123) 456-7890" or "Name – (123) 456-7890"
  const namePhonePatterns = [
    /contact\s+(?:info(?:rmation)?[:\s]+)?(?:(?:<b>)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:<\/b>)?)?\s*(?:at\s+\(?(\d{3})\)?[-\s.]?\d{3}[-\s.]?\d{4})/gi,
    /(?:<b>)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)(?:<\/b>)?\s+(?:at|–|-)\s+\(?(\d{3})\)?[-\s.]?\d{3}[-\s.]?\d{4}/g,
  ]

  for (const pattern of namePhonePatterns) {
    let m: RegExpExecArray | null
    while ((m = pattern.exec(textOnly)) !== null) {
      const key = `np:${m[1]?.trim()}:${m[2]}`
      if (seen.has(key)) continue
      seen.add(key)
      contacts.push({
        name: m[1]?.trim() || "",
        phone: `(${m[2]}) ${textOnly.match(new RegExp(`${m[2]}[)-]\\s*(\\d{3})[-.]?(\\d{4})`))?.[0]?.replace(/^.*?\(/, "(") ?? ""}`,
        email: null,
      })
    }
  }

  // Pattern 2: Standalone US phone numbers (no name required)
  const phoneRegex = /(?:call|phone|tel|contact|info)[:\s]*\(?(\d{3})\)?[-\s.]?\d{3}[-\s.]?\d{4}/gi
  let pm: RegExpExecArray | null
  while ((pm = phoneRegex.exec(textOnly)) !== null) {
    const fullMatch = pm[0]
    const areaCode = pm[1]
    const phoneMatch = fullMatch.match(/\(?(\d{3})\)?[-\s.]?(\d{3})[-.]?(\d{4})/)
    if (!phoneMatch) continue
    const phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`
    const key = `phone:${phone}`
    if (seen.has(key)) continue
    seen.add(key)

    // Look for a name before the phone indicator
    const before = textOnly.substring(Math.max(0, pm.index - 80), pm.index)
    const nameBefore = before.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)[\s,:]*$/)
    contacts.push({
      name: nameBefore?.[1]?.trim() || "",
      phone,
      email: null,
    })
  }

  // Pattern 3: Generic US phone number (no keyword prefix)
  const genericPhoneRegex = /\(?(\d{3})\)?[-\s.]?\d{3}[-.]?\d{4}/g
  let gp: RegExpExecArray | null
  while ((gp = genericPhoneRegex.exec(textOnly)) !== null) {
    const phoneMatch = gp[0].match(/\(?(\d{3})\)?[-\s.]?(\d{3})[-.]?(\d{4})/)
    if (!phoneMatch) continue
    const phone = `(${phoneMatch[1]}) ${phoneMatch[2]}-${phoneMatch[3]}`
    const key = `phone:${phone}`
    if (seen.has(key)) continue

    // Only capture if preceded by contact context within 100 chars
    const before = textOnly.substring(Math.max(0, gp.index - 100), gp.index).toLowerCase()
    if (!/(?:call|phone|tel|contact|info|tickets?|information|email|reach|at\s)/i.test(before)) continue
    seen.add(key)

    const nameMatch = before.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})[\s,:]*$/)
    contacts.push({
      name: nameMatch?.[1]?.trim() || "",
      phone,
      email: null,
    })
  }

  // Pattern 4: Emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
  let em: RegExpExecArray | null
  while ((em = emailRegex.exec(textOnly)) !== null) {
    const email = em[0]
    const key = `email:${email}`
    if (seen.has(key)) continue
    seen.add(key)

    const before = textOnly.substring(Math.max(0, em.index - 80), em.index)
    let name = ""
    const nameMatch = before.match(/(?:contact|email|e-?mail)[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i)
    if (nameMatch) {
      name = nameMatch[1].trim()
    } else {
      // Generic fallback: if there's a proper name before, use it
      const genericName = before.match(/([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})[\s,:]{1,3}$/)
      if (genericName) name = genericName[1].trim()
    }

    contacts.push({
      name,
      phone: null,
      email,
    })
  }

  return contacts
}

function extractExternalLinks(text: string): string[] {
  const links: string[] = []
  const $ = cheerio.load(`<div>${text}</div>`)
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")
    if (href && !href.startsWith("javascript:") && !href.startsWith("#") && !href.includes("Ad-Manager")) {
      const resolved = resolveUrl(href)
      if (resolved) links.push(resolved)
    }
  })
  return [...new Set(links)]
}

async function fetchListingCards(
  url: string,
  section: "current-events" | "facilities-update"
): Promise<BMEventCard[]> {
  const html = await fetchWithRetry(url)
  const $ = cheerio.load(html)
  const cards: BMEventCard[] = []
  const seen = new Set<string>()

  if (section === "current-events") {
    $("#SDisplayList1 .dataBusiness").each((_, el) => {
      const $a = $(el).find("a.dataBusiness").first()
      const href = $a.attr("href")
      const title = $a.text().trim()
      if (!title || !href) return
      const detailUrl = resolveUrl(href)
      if (!detailUrl || seen.has(detailUrl)) return
      seen.add(detailUrl)
      const previewText = $(el).closest(".dataBusiness").text().trim() || $(el).text().trim()
      cards.push({
        title,
        detailUrl,
        dateCategory: null,
        section,
        previewText: previewText || null,
      })
    })
  } else {
    const items = $('a[href*="Facilities-Update/"]').filter((_, el) => {
      const href = $(el).attr("href") || ""
      return href.includes("/Facilities-Update/20")
    })
    items.each((_, el) => {
      const $el = $(el)
      const href = $el.attr("href")
      const title = $el.text().trim()
      if (!title || !href) return
      const detailUrl = resolveUrl(href)
      if (!detailUrl || seen.has(detailUrl)) return
      seen.add(detailUrl)

      const parentText = $el.closest("tr").text()
      const yearMatch = href.match(/\/Facilities-Update\/(\d{4})\//)
      cards.push({
        title,
        detailUrl,
        dateCategory: yearMatch?.[1] ?? null,
        section,
        previewText: parentText || null,
      })
    })
  }

  return cards
}

async function scrapeDetailPage(url: string): Promise<{
  bodyText: string | null
}> {
  const html = await fetchWithRetry(url)
  const $ = cheerio.load(html)

  // Try multiple content selectors found on blackmeetingsandtourism.com detail pages
  const bodyText =
    $(".presscenter_data").text().trim() ||
    $("#ArticleDetail .presscenter_data").text().trim() ||
    $(".Content").text().trim() ||
    $(".article-content").text().trim() ||
    $(".post-content").text().trim() ||
    $(".entry-content").text().trim() ||
    $(".item-detail").text().trim() ||
    $(".detail-content").text().trim() ||
    $(".main-content").text().trim() ||
    $("#CenterContent").text().trim() ||
    $("#box1").text().trim() ||
    // Last resort: grab all visible text from the body, skipping nav/header/footer
    $("body")
      .clone()
      .find("script, style, nav, header, footer, .nav, .menu, .sidebar, .footer, .header")
      .remove()
      .end()
      .text()
      .trim() ||
    null
  return { bodyText }
}

export async function scrapeBMEvents(
  options: ScrapeBMOptions = {}
): Promise<BMEvent[]> {
  const {
    maxDetailPages = 50,
    skipDetailPages = false,
    sections = ["current-events", "facilities-update"],
  } = options

  const allCards: BMEventCard[] = []

  for (const section of sections) {
    const url = section === "current-events" ? CURRENT_EVENTS_URL : FACILITIES_UPDATE_URL
    console.log(`[blackmeetings] listing page: ${url}`)
    const cards = await fetchListingCards(url, section)
    allCards.push(...cards)
  }

  const events: BMEvent[] = []
  let detailsVisited = 0

  for (const card of allCards) {
    if (events.length >= maxDetailPages) break

    let bodyText: string | null = null

    if (!skipDetailPages && card.detailUrl) {
      try {
        const detail = await scrapeDetailPage(card.detailUrl)
        bodyText = detail.bodyText
        detailsVisited++
      } catch (err) {
        console.error(`[blackmeetings] detail failed for ${card.detailUrl}:`, err)
      }
      await delay(500 + Math.random() * 500)
    }

    const contentForExtraction = bodyText || card.previewText || ""
    const dates = contentForExtraction ? parseEventDates(contentForExtraction) : { start: null, end: null }
    const contacts = contentForExtraction ? extractContacts(contentForExtraction) : []
    const externalLinks = bodyText ? extractExternalLinks(bodyText) : []

    let venueName: string | null = null
    let venueLocation: string | null = null

    if (bodyText) {
      const venueRegex = /(?:at\s+|held\s+(?:at|in)\s+)(?:the\s+)?([A-Z][A-Za-z\s&.-]+?)(?:\s+(?:Convention\s+Center|Center|Hotel|Resort|Hall|Arena|Stadium))(?:\s|,|\.)/i
      const vm = venueRegex.exec(bodyText.replace(/<[^>]+>/g, " "))
      if (vm) {
        venueName = vm[0].replace(/^(?:at\s+|held\s+(?:at|in)\s+)/i, "").trim()
      }

      const locRegex = /(?:in\s+|located\s+in\s+)([A-Z][a-zA-Z\s.]+),\s*([A-Z]{2})/g
      const lm = locRegex.exec(bodyText.replace(/<[^>]+>/g, " "))
      if (lm) {
        venueLocation = `${lm[1].trim()}, ${lm[2]}`
      }
    }

    events.push({
      ...card,
      bodyText,
      eventName: card.title,
      venueName,
      venueLocation,
      eventDateStart: dates.start,
      eventDateEnd: dates.end,
      contacts,
      externalLinks,
      expectedAttendees: null,
      sourceSite: "blackmeetingsandtourism.com",
    })
  }

  return events.sort(
    (a, b) =>
      (a.eventDateStart?.getTime() ?? 0) - (b.eventDateStart?.getTime() ?? 0)
  )
}

export async function scrapeBMVenues(
  options: { maxVenues?: number } = {}
): Promise<BMVenue[]> {
  const { maxVenues = 50 } = options

  const html = await fetchWithRetry(CONVENTION_CENTERS_URL)
  const $ = cheerio.load(html)
  const venueLinks: { name: string; href: string }[] = []

  $("#CenterContent ul li a, #CenterContent a[href*='Meetings-Conventions/']").each((_, el) => {
    const $el = $(el)
    const href = $el.attr("href")
    const name = $el.text().trim()
    if (!name || !href) return
    if (!href.includes("Meetings-Conventions/")) return
    venueLinks.push({ name, href: new URL(href, BASE).toString() })
  })

  if (venueLinks.length === 0) {
    $("ul li a").each((_, el) => {
      const href = $(el).attr("href") || ""
      const name = $(el).text().trim()
      if (!name || !href) return
      if (!href.includes("Meetings-Conventions/")) return
      venueLinks.push({ name, href: new URL(href, BASE).toString() })
    })
  }

  const venues: BMVenue[] = []
  const toScrape = venueLinks.slice(0, maxVenues)

  for (const vl of toScrape) {
    console.log(`[blackmeetings] venue: ${vl.name}`)
    try {
      const html = await fetchWithRetry(vl.href)
      const $ = cheerio.load(html)

      const centerContent = $("#CenterContent, #box1 #CenterContent")
      let htmlContent = centerContent.html() ?? ""

      if (!htmlContent) {
        htmlContent = $("#box1").html() ?? ""
      }

      const description = htmlToText(htmlContent)

      const exhibitMatch = htmlContent.match(/Total\s+exhibit\s+space[:\s]*([^<]+)/i)
      const ballroomMatch = htmlContent.match(/(?:Largest\s+)?ballroom[:\s]*([^<]+)/i)
      const roomsMatch = htmlContent.match(/Number\s+of\s+meeting\s+rooms[:\s]*([^<]+)/i)
      const getInTouchMatch = htmlContent.match(/Getting\s+In\s+Touch[^<]*/i)

      const strongTags: string[] = []
      $("strong").each((_, el) => {
        const t = $(el).text().trim()
        if (t) strongTags.push(t)
      })

      let contactName: string | null = null
      let contactPhone: string | null = null
      let website: string | null = null

      if (getInTouchMatch) {
        const afterGetInTouch = htmlContent.substring(
          htmlContent.indexOf(getInTouchMatch[0]) + getInTouchMatch[0].length
        )
        const namePhoneMatch = afterGetInTouch.match(
          /<strong>([^<]+)<\/strong>\s*[–-]?\s*\(?(\d{3})\)?[-\s.]?\d{3}[-\s.]?\d{4}/
        )
        if (namePhoneMatch) {
          contactName = namePhoneMatch[1].trim()
          contactPhone = namePhoneMatch[0].replace(/<strong>|<\/strong>/g, "").trim()
        }
      }

      const linkEl = centerContent.find("a[href^='http']").first()
      if (linkEl.length) {
        website = linkEl.attr("href") ?? null
      }

      venues.push({
        name: vl.name,
        detailUrl: vl.href,
        description: description || null,
        totalExhibitSpace: exhibitMatch?.[1]?.trim() ?? null,
        largestBallroom: ballroomMatch?.[1]?.trim() ?? null,
        meetingRooms: roomsMatch?.[1]?.trim() ?? null,
        contactName,
        contactPhone,
        website,
        sourceSite: "blackmeetingsandtourism.com",
      })
    } catch (err) {
      console.error(`[blackmeetings] venue detail failed for ${vl.name}:`, err)
    }
    await delay(500 + Math.random() * 500)
  }

  return venues
}
