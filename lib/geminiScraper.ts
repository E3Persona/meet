import { GoogleGenAI } from "@google/genai"
import type { Interactions } from "@google/genai"
import { hashContent } from "@/lib/scrape/blockSplitter"
import { extractDateRange } from "@/lib/scrape/dateExtractor"

export interface GeminiParsedEvent {
  eventName: string
  eventDateStart: Date | null
  eventDateEnd: Date | null
  description: string | null
  sourceUrl: string | null
  rawText: string
}

export interface GeminiScrapeResult {
  events: GeminiParsedEvent[]
  rawBlocks: GeminiRawBlock[]
  usage: Record<string, unknown> | null
  searchQueries: string[]
}

export interface GeminiRawBlock {
  blockHash: string
  identityKey: string
  rawText: string
}

export interface VenueInfo {
  id: string
  name: string
  city: string
  state: string
  directoryId: string | null
}

const EVENT_START = "---EVENT---"
const EVENT_END = "---END_EVENT---"

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.5-flash"

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

export async function scrapeViaLocationSearch(
  venue: VenueInfo,
): Promise<GeminiScrapeResult> {
  const prompt = buildLocationSearchPrompt(venue)
  if (process.env.DEBUG_GEMINI) console.error("[geminiScraper] Sending google_search request for", venue.name)
  const interaction = await withTimeout(
    ai.interactions.create({
      model: MODEL,
      input: prompt,
      tools: [{ type: "google_search" }],
    }),
    parseInt(process.env.GEMINI_TIMEOUT_MS ?? "60000"),
  )

  return processInteraction(interaction)
}

export async function scrapeViaUrlContext(
  urls: string[],
  venue?: VenueInfo,
): Promise<GeminiScrapeResult> {
  const BATCH_SIZE = 20
  if (urls.length > BATCH_SIZE) {
    urls = urls.slice(0, BATCH_SIZE)
  }

  const prompt = buildUrlContextPrompt(urls, venue)
  if (process.env.DEBUG_GEMINI) console.error("[geminiScraper] Sending url_context request for", urls.length, "URLs")
  const interaction = await withTimeout(
    ai.interactions.create({
      model: MODEL,
      input: prompt,
      tools: [{ type: "url_context" }],
    }),
    parseInt(process.env.GEMINI_TIMEOUT_MS ?? "60000"),
  )
  if (process.env.DEBUG_GEMINI) {
    const output = (interaction as unknown as Record<string, unknown>).output_text
    if (typeof output === "string") {
      console.error("[geminiScraper] Raw response text (first 1000 chars):", output.slice(0, 1000))
      console.error("[geminiScraper] Response length:", output.length)
    }
  }

  return processInteraction(interaction)
}

export async function scrapeViaSearchAndRead(
  venue: VenueInfo,
): Promise<GeminiScrapeResult> {
  const prompt = buildSearchAndReadPrompt(venue)
  if (process.env.DEBUG_GEMINI) console.error("[geminiScraper] Sending combined search+url_context request for", venue.name)
  const interaction = await withTimeout(
    ai.interactions.create({
      model: MODEL,
      input: prompt,
      tools: [{ type: "google_search" }, { type: "url_context" }],
    }),
    parseInt(process.env.GEMINI_TIMEOUT_MS ?? "60000"),
  )

  return processInteraction(interaction)
}

function buildLocationSearchPrompt(venue: VenueInfo): string {
  const now = new Date()
  const threeMonths = new Date(now)
  threeMonths.setMonth(threeMonths.getMonth() + 3)
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const endStr = threeMonths.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  return `Search the web for upcoming events, conferences, conventions, and trade shows happening at ${venue.name} in ${venue.city}, ${venue.state} between ${dateStr} and ${endStr}.

Try multiple searches — the venue's own calendar, third-party event listings, convention calendars. Be thorough.

For each event you find, output in this format:

${EVENT_START}
Name: Full official event name
Date: Event date or date range
Time: Event time if available
Description: Brief description
${EVENT_END}

If you cannot find any events, briefly explain what you searched and why nothing was found.`
}

function buildUrlContextPrompt(urls: string[], venue?: VenueInfo): string {
  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join("\n")
  const venueContext = venue
    ? ` for ${venue.name} in ${venue.city}, ${venue.state}`
    : ""

  return `Read the following URLs and extract all upcoming events${venueContext} from them:

${urlList}

If a URL cannot be read or is behind a login wall, try to find the same information by searching for the venue name and city instead.

For each event you find, output in this format:

${EVENT_START}
Name: Full official event name
Date: Event date or date range
Time: Event time if available
Description: Brief description
${EVENT_END}

If no events are found, briefly explain why — access restrictions, no event listings on the page, or other reasons.`
}

function buildSearchAndReadPrompt(venue: VenueInfo): string {
  const now = new Date()
  const threeMonths = new Date(now)
  threeMonths.setMonth(threeMonths.getMonth() + 3)
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
  const endStr = threeMonths.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })

  return `Find upcoming events, conferences, conventions, and trade shows happening at ${venue.name} in ${venue.city}, ${venue.state} between ${dateStr} and ${endStr}.

First use Google Search to find the venue's events page or calendar URLs.
Then use URL context to read the actual event listing pages you find.

For each event you find, output in this format:

${EVENT_START}
Name: Full official event name
Date: Event date or date range
Time: Event time if available
Description: Brief description
${EVENT_END}

Only include events confirmed to be at ${venue.name}. If you cannot find any, output nothing.`
}

function processInteraction(interaction: Interactions.Interaction): GeminiScrapeResult {
  const textBlocks: Array<{ text: string; annotations: Interactions.Annotation[] }> = []
  let usage: Record<string, unknown> | null = null
  const searchQueries: string[] = []

  const steps = (interaction as { steps?: Interactions.Step[] }).steps ?? []

  for (const step of steps) {
    if (step.type === "model_output") {
      const content = (step as Interactions.ModelOutputStep).content ?? []
      for (const block of content) {
        if (block.type === "text") {
          const tb = block as Interactions.TextContent
          textBlocks.push({
            text: tb.text,
            annotations: tb.annotations ?? [],
          })
        }
      }
    }
    if (step.type === "google_search_call") {
      const gsc = step as Interactions.GoogleSearchCallStep
      if (gsc.arguments?.queries) {
        searchQueries.push(...gsc.arguments.queries)
      }
    }
  }

  const rawInteraction = interaction as unknown as Record<string, unknown>
  if (rawInteraction.usage) {
    usage = rawInteraction.usage as Record<string, unknown>
  } else if (rawInteraction.usageMetadata) {
    usage = rawInteraction.usageMetadata as Record<string, unknown>
  }

  const allText = textBlocks.map((b) => b.text).join("\n")
  const allAnnotations = textBlocks.flatMap((b) => b.annotations)

  const rawBlocks = parseEventBlocks(allText)
  const citationMap = mapCitationsToBlocks(rawBlocks, allAnnotations)

  const events: GeminiParsedEvent[] = rawBlocks.map((block, i) => {
    const parsed = parseSingleEventBlock(block.rawText)
    return {
      eventName: parsed.eventName ?? "Unknown Event",
      eventDateStart: parsed.eventDateStart,
      eventDateEnd: parsed.eventDateEnd,
      description: parsed.description,
      sourceUrl: citationMap.get(i)?.url ?? citationMap.get(i)?.title ?? null,
      rawText: block.rawText,
    }
  }).filter((e) => e.eventName && e.eventName !== "Unknown Event")

  return {
    events,
    rawBlocks: rawBlocks.map((b) => ({
      blockHash: hashContent(b.rawText),
      identityKey: hashContent(b.rawText),
      rawText: b.rawText,
    })),
    usage,
    searchQueries,
  }
}

function parseEventBlocks(text: string): Array<{ rawText: string; start: number; end: number }> {
  const blocks: Array<{ rawText: string; start: number; end: number }> = []
  const regex = new RegExp(
    `${EVENT_START}\\s*\\n([\\s\\S]*?)${EVENT_END}`,
    "g",
  )
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      rawText: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  return blocks
}

function parseSingleEventBlock(rawText: string): {
  eventName: string | null
  eventDateStart: Date | null
  eventDateEnd: Date | null
  description: string | null
} {
  const name = rawText.match(/^Name:\s*(.+)$/m)?.[1]?.trim() ?? null
  const dateStr = rawText.match(/^Date:\s*(.+)$/m)?.[1]?.trim() ?? null
  const desc = rawText.match(/^Description:\s*(.+)$/m)?.[1]?.trim() ?? null

  const range = dateStr ? extractDateRange(dateStr) : null

  return {
    eventName: name,
    eventDateStart: range?.start ?? null,
    eventDateEnd: range?.end ?? null,
    description: desc ?? null,
  }
}



function mapCitationsToBlocks(
  blocks: Array<{ rawText: string; start: number; end: number }>,
  annotations: Interactions.Annotation[],
): Map<number, { url: string; title: string | undefined }> {
  type Entry = { url: string; title: string | undefined; startIndex: number }
  const map = new Map<number, Entry>()

  for (const ann of annotations) {
    if (ann.type !== "url_citation") continue
    const citation = ann as Interactions.URLCitation
    const url = citation.url
    if (!url) continue

    const si = citation.start_index ?? -1
    const ei = citation.end_index ?? -1
    if (si === -1 || ei === -1) continue

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i]
      if (si < block.end && ei > block.start) {
        const existing = map.get(i)
        if (!existing || si < existing.startIndex) {
          map.set(i, { url, title: citation.title, startIndex: si })
        }
      }
    }
  }

  const result = new Map<number, { url: string; title: string | undefined }>()
  for (const [key, val] of map) {
    result.set(key, { url: val.url, title: val.title })
  }
  return result
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gemini API timed out after ${ms / 1000}s`)), ms)
  })
  try {
    const result = await Promise.race([promise, timeout])
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export {
  EVENT_START,
  EVENT_END,
  buildLocationSearchPrompt,
  buildUrlContextPrompt,
  buildSearchAndReadPrompt,
  parseEventBlocks,
  parseSingleEventBlock,
  mapCitationsToBlocks,
}
