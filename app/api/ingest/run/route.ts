import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// ─── NEVER touch these fields from automated code ─────────────────────────────
// AGENTS.md hard boundary: organizerName, organizerTitle, organizerEmail,
// organizerPhone are ONLY filled by humans via inline-edit UI.

// ─── CRON SCHEDULING ──────────────────────────────────────────────────────────
// OPTION A — Vercel Cron (see vercel.json)
// OPTION B — cron-job.org: POST https://your-domain.com/api/ingest/run?trigger=scheduled
// OPTION C — Coolify: curl -X POST http://localhost:3000/api/ingest/run?trigger=scheduled
// ─────────────────────────────────────────────────────────────────────────────

const TAVILY_API_URL = "https://api.tavily.com/search"
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

// Use a cheap, fast model for extraction
const LLM_MODEL = "google/gemini-2.5-flash"

interface TavilyResult {
  title: string
  url: string
  content: string
  score: number
}

interface ExtractedEvent {
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  organizerName: string | null
  organizerTitle: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  confidence: "high" | "medium" | "low"
  reason: string
}

// ─── Build search queries ─────────────────────────────────────────────────────

function buildSearchQueries(
  locations: {
    id: string
    name: string
    searchTerms: { id: string; keyword: string }[]
  }[]
) {
  const queries: {
    locationId: string
    locationName: string
    keyword: string
    query: string
    monthLabel: string
  }[] = []

  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthName = d.toLocaleString("en-US", { month: "long" })
    const year = d.getFullYear()
    const monthLabel = `${monthName} ${year}`

    for (const location of locations) {
      for (const term of location.searchTerms) {
        queries.push({
          locationId: location.id,
          locationName: location.name,
          keyword: term.keyword,
          query: `${monthLabel} ${term.keyword} ${location.name}`,
          monthLabel,
        })
      }
    }
  }
  return queries
}

// ─── Search Tavily ────────────────────────────────────────────────────────────

async function searchTavily(query: string): Promise<TavilyResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error("TAVILY_API_KEY not set")

  const res = await fetch(TAVILY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: "advanced",
      max_results: 5,
      include_answer: false,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    console.error(`[Tavily] Error ${res.status}: ${text}`)
    return []
  }

  const data = await res.json()
  return data.results ?? []
}

// ─── Scrape page with Firecrawl ───────────────────────────────────────────────

async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
      }),
    })

    if (!res.ok) {
      console.error(`[Firecrawl] Error ${res.status} for ${url}`)
      return null
    }

    const data = await res.json()
    return data.data?.markdown ?? null
  } catch (err) {
    console.error(`[Firecrawl] Failed to scrape ${url}:`, err)
    return null
  }
}

// ─── LLM Extraction ───────────────────────────────────────────────────────────

async function extractEventsWithLLM(
  pageContent: string,
  pageTitle: string,
  pageUrl: string,
  locationName: string,
  searchMonth: string
): Promise<ExtractedEvent[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    console.error("[LLM] OPENROUTER_API_KEY not set, skipping extraction")
    return []
  }

  // Truncate content to stay within context limits
  const maxContentLength = 8000
  const truncatedContent =
    pageContent.length > maxContentLength
      ? pageContent.slice(0, maxContentLength) + "\n\n[Content truncated...]"
      : pageContent

  const prompt = `You are an expert event data extractor specializing in Meetings, Conventions, Tradeshows, Conferences, and Expos.

CONTEXT:
- We are searching for events at: ${locationName}
- The search was for month: ${searchMonth}
- Page title: ${pageTitle}
- Page URL: ${pageUrl}

PAGE CONTENT:
${truncatedContent}

TASK:
Extract ALL events/conferences/tradeshows mentioned on this page. For each event, provide:

EVENT INFO:
1. eventName: The full, accurate name of the event (e.g. "ACoP 2026 Annual Meeting", "NASFAA National Conference 2026")
2. eventDateStart: Start date in ISO format (YYYY-MM-DD) if found, null if not
3. eventDateEnd: End date in ISO format (YYYY-MM-DD) if found, null if not

CONTACT INFO (extract if visible on this page):
4. organizerName: Full name of a contact person (e.g. "Joan Smith", "John Doe"). Look for: registration contacts, event planners, meeting managers, conference coordinators, CMP holders, lead retrieval contacts. Often found in "Contact Us", "Registration", "For More Information" sections, or email signatures.
5. organizerTitle: Their title/role (e.g. "Conference Planner", "Registration Manager", "Event Manager", "CMP", "Meeting Manager", "Lead Retrieval")
6. organizerEmail: Their email address (e.g. "jsmith@acr.org"). Look for email addresses on the page.
7. organizerPhone: Their phone number (e.g. "123-456-7891"). Look for phone numbers on the page.

CONFIDENCE:
8. confidence: "high" if event name and dates are clearly stated, "medium" if partially clear, "low" if inferred
9. reason: Brief note on where/how you found this event and any contact info

RULES:
- Extract events that are AT or NEAR the venue "${locationName}" in ${searchMonth}
- If this is a venue listing page, extract ALL upcoming events listed
- If this is an event detail page, extract that single event
- Be precise with event names — include year, full title
- Only extract events that are meetings, conventions, tradeshow, conferences, expos, summits, forums, shows, or similar professional gatherings
- Do NOT extract: venue hotel info, restaurant listings, general tourism content
- For contact info: only extract if clearly associated with THIS specific event, not general venue contacts
- Return empty array if no relevant events found

KNOWN CONTACT TITLES (look for these or similar):
Registration Manager, Event Manager, CMP, Certified Meeting Planner, Meeting Manager, Conference Planner, Lead Retrieval, Director of Sales, Group Sales Manager, Event Coordinator, Program Manager

RESPOND WITH VALID JSON ONLY — no markdown, no explanation:
{
  "events": [
    {
      "eventName": "...",
      "eventDateStart": "YYYY-MM-DD" or null,
      "eventDateEnd": "YYYY-MM-DD" or null,
      "organizerName": "..." or null,
      "organizerTitle": "..." or null,
      "organizerEmail": "..." or null,
      "organizerPhone": "..." or null,
      "confidence": "high" | "medium" | "low",
      "reason": "..."
    }
  ]
}`

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://event-pipeline-dashboard.local",
        "X-OpenRouter-Title": "Event Pipeline Dashboard",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a precise event data extraction engine. Always respond with valid JSON only.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[LLM] Error ${res.status}: ${text}`)
      return []
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return []

    const parsed = JSON.parse(content)
    return parsed.events ?? []
  } catch (err) {
    console.error("[LLM] Extraction failed:", err)
    return []
  }
}

// ─── Dedupe check ─────────────────────────────────────────────────────────────

async function isDuplicate(
  eventName: string,
  locationId: string,
  eventDateStart: Date | null
): Promise<boolean> {
  const existing = await prisma.event.findFirst({
    where: {
      eventName: { equals: eventName, mode: "insensitive" },
      locationId,
      eventDateStart: eventDateStart ?? undefined,
    },
  })
  return !!existing
}

// ─── Sleep helper ─────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── POST /api/ingest/run ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const trigger =
    searchParams.get("trigger") === "scheduled" ? "scheduled" : "manual"

  console.log(`\n[Ingest] Starting ${trigger} run at ${new Date().toISOString()}`)

  // Create ingestion run
  const run = await prisma.ingestionRun.create({
    data: { trigger, status: "running" },
  })

  try {
    // Get active locations with active search terms
    const locations = await prisma.location.findMany({
      where: { active: true },
      include: {
        searchTerms: { where: { active: true } },
      },
    })

    if (locations.length === 0) {
      console.log("[Ingest] No active locations found")
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: "success",
          finishedAt: new Date(),
          recordsFound: 0,
          recordsNew: 0,
          errorMessage: "No active locations with search terms",
        },
      })
      return NextResponse.json({
        runId: run.id,
        recordsFound: 0,
        recordsNew: 0,
        message: "No active locations found",
      })
    }

    const totalSearchTerms = locations.reduce(
      (sum, loc) => sum + loc.searchTerms.length,
      0
    )
    console.log(
      `[Ingest] ${locations.length} locations, ${totalSearchTerms} search terms`
    )

    // Build search queries
    const allQueries = buildSearchQueries(locations)
    console.log(`[Ingest] ${allQueries.length} total search queries to process`)

    let totalFound = 0
    let totalNew = 0
    let queriesProcessed = 0

    // Process queries SEQUENTIALLY to avoid rate limits
    for (const q of allQueries) {
      queriesProcessed++
      if (queriesProcessed % 10 === 0) {
        console.log(
          `[Ingest] Progress: ${queriesProcessed}/${allQueries.length} queries, ${totalNew} new events`
        )
      }

      // Rate limit: 1 Tavily request per second
      await sleep(1000)

      // Step 1: Search Tavily
      let tavilyResults: TavilyResult[]
      try {
        tavilyResults = await searchTavily(q.query)
      } catch (err) {
        console.error(`[Tavily] Failed for "${q.query}":`, err)
        continue
      }

      if (tavilyResults.length === 0) {
        console.log(`[Tavily] No results for "${q.query}"`)
        continue
      }

      console.log(
        `[Tavily] ${tavilyResults.length} results for "${q.query}"`
      )

      // Step 2: For each result, optionally scrape + LLM extract
      for (const tavilyResult of tavilyResults) {
        totalFound++

        // Try Firecrawl first for full page content, fall back to Tavily snippet
        let pageContent = tavilyResult.content
        if (process.env.FIRECRAWL_API_KEY && tavilyResult.url) {
          await sleep(500) // Rate limit Firecrawl
          const scraped = await scrapeWithFirecrawl(tavilyResult.url)
          if (scraped && scraped.length > pageContent.length) {
            pageContent = scraped
          }
        }

        // Step 3: LLM extraction
        await sleep(300) // Rate limit LLM
        const extractedEvents = await extractEventsWithLLM(
          pageContent,
          tavilyResult.title,
          tavilyResult.url,
          q.locationName,
          q.monthLabel
        )

        if (extractedEvents.length === 0) {
          console.log(
            `[LLM] No events extracted from ${tavilyResult.url}`
          )
          continue
        }

        console.log(
          `[LLM] Extracted ${extractedEvents.length} event(s) from ${tavilyResult.url}`
        )

        // Step 4: Store each extracted event
        for (const extracted of extractedEvents) {
          // Skip low-confidence events
          if (extracted.confidence === "low") {
            console.log(
              `[Skip] Low confidence: "${extracted.eventName}" — ${extracted.reason}`
            )
            continue
          }

          // Parse dates
          let eventDateStart: Date | null = null
          let eventDateEnd: Date | null = null
          if (extracted.eventDateStart) {
            const d = new Date(extracted.eventDateStart)
            if (!isNaN(d.getTime())) eventDateStart = d
          }
          if (extracted.eventDateEnd) {
            const d = new Date(extracted.eventDateEnd)
            if (!isNaN(d.getTime())) eventDateEnd = d
          }

          const eventName = extracted.eventName.trim()
          if (eventName.length < 3) continue

          // Dedupe
          const dup = await isDuplicate(eventName, q.locationId, eventDateStart)
          if (dup) {
            console.log(`[Skip] Duplicate: "${eventName}"`)
            continue
          }

          // Insert — store event info + any contacts found on the page
          await prisma.event.create({
            data: {
              locationId: q.locationId,
              eventName,
              eventDateStart,
              eventDateEnd,
              sourceUrl: tavilyResult.url,
              runId: run.id,
              organizerName: extracted.organizerName?.trim() || null,
              organizerTitle: extracted.organizerTitle?.trim() || null,
              organizerEmail: extracted.organizerEmail?.trim() || null,
              organizerPhone: extracted.organizerPhone?.trim() || null,
            },
          })
          totalNew++
          console.log(
            `[New] "${eventName}" (${eventDateStart?.toISOString().slice(0, 10) ?? "no date"})`
          )
        }
      }
    }

    // Finalize run
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        recordsFound: totalFound,
        recordsNew: totalNew,
      },
    })

    console.log(
      `\n[Ingest] Complete: ${totalNew} new events from ${totalFound} results scanned`
    )

    return NextResponse.json({
      runId: run.id,
      recordsFound: totalFound,
      recordsNew: totalNew,
    })
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error"
    console.error(`[Ingest] Fatal error:`, error)

    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage,
      },
    })

    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
