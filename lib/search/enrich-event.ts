import "dotenv/config"
import axios from "axios"
import * as cheerio from "cheerio"
import { createHash } from "crypto"
import { prisma } from "@/lib/prisma"
import { EventMatchType, ExtractionMethod } from "../generated/prisma/enums"

export interface EnrichInput {
  url: string
  locationId: string // the CITY or VENUE Location this search was scoped to
  matchType: EventMatchType // venue_matched | location_matched, based on what the search targeted
  sourceSiteId?: string | null
  runId?: string | null
  fallbackEventDate?: string | null // ISO date from the SERP result, used if the page itself has no parseable date
  timeoutMs?: number
}

export interface EnrichResult {
  eventId: string
  eventName: string
  eventDateStart: string | null
  extractionMethod: ExtractionMethod
  hadEmail: boolean
}

interface ExtractedEvent {
  eventName: string | null
  eventDateStart: string | null // ISO
  eventDateEnd: string | null // ISO
  venueText: string | null
  organizerName: string | null
  organizerEmail: string | null
  description: string | null
}

const DEFAULT_TIMEOUT_MS = 15_000

function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

/* ──────────────────────────────────────────────────────────
   Layer 1: JSON-LD schema.org Event
   Most legitimate event/ticketing pages (Eventbrite, chamber
   sites, .gov event pages) embed this. Highest-confidence source.
   ────────────────────────────────────────────────────────── */
function extractFromJsonLd($: cheerio.CheerioAPI): ExtractedEvent | null {
  const scripts = $('script[type="application/ld+json"]').toArray()

  for (const script of scripts) {
    const raw = $(script).contents().text()
    if (!raw?.trim()) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    for (const candidate of candidates) {
      const node = candidate as Record<string, unknown>
      const graph = Array.isArray(node?.["@graph"])
        ? (node["@graph"] as Record<string, unknown>[])
        : [node]

      for (const item of graph) {
        const type = item?.["@type"]
        const isEvent =
          type === "Event" ||
          (Array.isArray(type) && type.includes("Event")) ||
          (typeof type === "string" && type.toLowerCase().includes("event"))
        if (!isEvent) continue

        const name = typeof item.name === "string" ? item.name.trim() : null
        const startDate =
          typeof item.startDate === "string" ? item.startDate : null
        const endDate = typeof item.endDate === "string" ? item.endDate : null

        let venueText: string | null = null
        const location = item.location as Record<string, unknown> | undefined
        if (location) {
          const locName = typeof location.name === "string" ? location.name : ""
          const address = location.address as
            Record<string, unknown> | string | undefined
          let addressText = ""
          if (typeof address === "string") addressText = address
          else if (address) {
            addressText = [
              address.streetAddress,
              address.addressLocality,
              address.addressRegion,
            ]
              .filter((v) => typeof v === "string" && v.trim())
              .join(", ")
          }
          venueText = [locName, addressText].filter(Boolean).join(", ") || null
        }

        let organizerName: string | null = null
        const organizer = item.organizer as Record<string, unknown> | undefined
        if (organizer && typeof organizer.name === "string")
          organizerName = organizer.name

        const description =
          typeof item.description === "string"
            ? item.description.trim().slice(0, 500)
            : null

        if (name) {
          return {
            eventName: name,
            eventDateStart: startDate ? safeIso(startDate) : null,
            eventDateEnd: endDate ? safeIso(endDate) : null,
            venueText,
            organizerName,
            organizerEmail: null, // JSON-LD rarely includes this directly
            description,
          }
        }
      }
    }
  }

  return null
}

function safeIso(dateStr: string): string | null {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/* ──────────────────────────────────────────────────────────
   Layer 2: OpenGraph / meta tags
   Weaker signal — gives a title/description but rarely a
   structured date, so we still regex the description for one.
   ────────────────────────────────────────────────────────── */
function extractFromMeta($: cheerio.CheerioAPI): ExtractedEvent | null {
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim()
  const title = ogTitle || $("title").first().text().trim()
  if (!title) return null

  const description =
    $('meta[property="og:description"]').attr("content")?.trim() ||
    $('meta[name="description"]').attr("content")?.trim() ||
    null

  const dateFromDescription = description ? findDateInText(description) : null

  return {
    eventName: title,
    eventDateStart: dateFromDescription,
    eventDateEnd: null,
    venueText: null,
    organizerName: null,
    organizerEmail: null,
    description: description ? description.slice(0, 500) : null,
  }
}

/* ──────────────────────────────────────────────────────────
   Layer 3: plain text heuristics (last resort)
   ────────────────────────────────────────────────────────── */
function findDateInText(text: string): string | null {
  const isoMatch = text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (isoMatch) {
    const d = new Date(
      Date.UTC(
        Number(isoMatch[1]),
        Number(isoMatch[2]) - 1,
        Number(isoMatch[3])
      )
    )
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  const monthMatch = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  )
  if (monthMatch) {
    const monthNames = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ]
    const month = monthNames.indexOf(monthMatch[1].slice(0, 3).toLowerCase())
    const d = new Date(
      Date.UTC(Number(monthMatch[3]), month, Number(monthMatch[2]))
    )
    if (!isNaN(d.getTime())) return d.toISOString()
  }

  return null
}

function findEmailInText(text: string): string | null {
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
  return match ? match[0] : null
}

function findOrganizerNear(html: string): string | null {
  const $ = cheerio.load(html)
  const labelRegex = /organiz(?:er|ed by)|hosted by|presented by/i

  let organizer: string | null = null
  $("*").each((_, el) => {
    if (organizer) return
    const text = $(el).text().trim()
    if (text.length > 0 && text.length < 200 && labelRegex.test(text)) {
      const cleaned = text
        .replace(labelRegex, "")
        .replace(/^[:\-–\s]+/, "")
        .trim()
      if (cleaned) organizer = cleaned.slice(0, 200)
    }
  })
  return organizer
}

/* ──────────────────────────────────────────────────────────
   Fetch + orchestrate extraction
   ────────────────────────────────────────────────────────── */
async function fetchHtml(
  url: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
    })
    return typeof response.data === "string" ? response.data : null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[Enrich] Fetch failed for ${url}: ${message}`)
    return null
  }
}

function extractEvent(html: string): ExtractedEvent | null {
  const $ = cheerio.load(html)

  const jsonLd = extractFromJsonLd($)
  if (jsonLd?.eventName) {
    // JSON-LD found a name but maybe not email/organizer — fill gaps from text.
    const bodyText = $("body").text().replace(/\s+/g, " ")
    if (!jsonLd.organizerEmail)
      jsonLd.organizerEmail = findEmailInText(bodyText)
    if (!jsonLd.organizerName) jsonLd.organizerName = findOrganizerNear(html)
    return jsonLd
  }

  const meta = extractFromMeta($)
  if (meta?.eventName) {
    const bodyText = $("body").text().replace(/\s+/g, " ")
    meta.organizerEmail = findEmailInText(bodyText)
    meta.organizerName = findOrganizerNear(html)
    if (!meta.eventDateStart) meta.eventDateStart = findDateInText(bodyText)
    return meta
  }

  return null
}

/**
 * Fetches a SERP result URL, extracts event data via cheerio, and upserts
 * an Event (+ EventContact + EventDetailPage) row. Fails soft — returns
 * null on any failure so the caller can keep the raw WebSearchResult
 * regardless of whether enrichment succeeded.
 */
export async function enrichEvent(
  input: EnrichInput
): Promise<EnrichResult | null> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const html = await fetchHtml(input.url, timeoutMs)
  if (!html) return null

  const extracted = extractEvent(html)
  if (!extracted?.eventName) {
    console.warn(`[Enrich] No event data extracted from ${input.url}`)
    return null
  }

  const eventDateStart =
    extracted.eventDateStart || input.fallbackEventDate || null
  const extractionMethod: ExtractionMethod = "cheerio_html"

  try {
    const event = await prisma.event.upsert({
      where: {
        locationId_eventName_eventDateStart: {
          locationId: input.locationId,
          eventName: extracted.eventName,
          eventDateStart: eventDateStart
            ? new Date(eventDateStart)
            : (null as unknown as Date),
        },
      },
      update: {
        sourceUrl: input.url,
        eventDateEnd: extracted.eventDateEnd
          ? new Date(extracted.eventDateEnd)
          : undefined,
        rawVenueText: extracted.venueText ?? undefined,
        organizerName: extracted.organizerName ?? undefined,
        organizerEmail: extracted.organizerEmail ?? undefined,
        extractionMethod,
        matchType: input.matchType,
        runId: input.runId ?? undefined,
        sourceSiteId: input.sourceSiteId ?? undefined,
      },
      create: {
        locationId: input.locationId,
        eventName: extracted.eventName,
        eventDateStart: eventDateStart ? new Date(eventDateStart) : null,
        eventDateEnd: extracted.eventDateEnd
          ? new Date(extracted.eventDateEnd)
          : null,
        sourceUrl: input.url,
        rawVenueText: extracted.venueText,
        organizerName: extracted.organizerName,
        organizerEmail: extracted.organizerEmail,
        matchType: input.matchType,
        extractionMethod,
        runId: input.runId ?? null,
        sourceSiteId: input.sourceSiteId ?? null,
      },
    })

    if (extracted.organizerEmail || extracted.organizerName) {
      await prisma.eventContact
        .upsert({
          where: {
            // No natural unique key on (eventId, email) in your schema yet,
            // so we find-then-create to avoid duplicate contacts per event.
            id:
              (
                await prisma.eventContact.findFirst({
                  where: {
                    eventId: event.id,
                    email: extracted.organizerEmail ?? undefined,
                  },
                  select: { id: true },
                })
              )?.id ?? "___none___",
          },
          update: {
            name: extracted.organizerName ?? undefined,
            email: extracted.organizerEmail ?? undefined,
          },
          create: {
            eventId: event.id,
            name: extracted.organizerName ?? "Unknown",
            email: extracted.organizerEmail,
            isPrimary: true,
            sourceUrl: input.url,
            confidence: "medium",
          },
        })
        .catch(async () => {
          // upsert-by-fake-id fallback: just create if no existing contact matched
          await prisma.eventContact.create({
            data: {
              eventId: event.id,
              name: extracted.organizerName ?? "Unknown",
              email: extracted.organizerEmail,
              isPrimary: true,
              sourceUrl: input.url,
              confidence: "medium",
            },
          })
        })
    }

    const fullHash = hashContent(html)
    await prisma.eventDetailPage.upsert({
      where: { eventId_url: { eventId: event.id, url: input.url } },
      update: { fullHash, lastFetchedAt: new Date() },
      create: {
        eventId: event.id,
        url: input.url,
        fullHash,
        rawMarkdown: extracted.description,
        lastFetchedAt: new Date(),
      },
    })

    return {
      eventId: event.id,
      eventName: extracted.eventName,
      eventDateStart,
      extractionMethod,
      hadEmail: Boolean(extracted.organizerEmail),
    }
  } catch (err) {
    console.error(`[Enrich] DB upsert failed for ${input.url}:`, err)
    return null
  }
}
