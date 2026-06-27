import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const TAVILY_API_URL = "https://api.tavily.com/search"
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const LLM_MODEL = "google/gemini-2.5-flash"

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function searchTavily(query: string): Promise<{ title: string; url: string; content: string }[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []

  try {
    const res = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        max_results: 5,
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  } catch {
    return []
  }
}

async function scrapeUrl(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null

  try {
    const res = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.markdown ?? null
  } catch {
    return null
  }
}

async function llmExtractContacts(
  pageContent: string,
  pageTitle: string,
  pageUrl: string,
  eventName: string
): Promise<{
  organizerName: string | null
  organizerTitle: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  confidence: string
  sourceUrl: string
} | null> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const maxLen = 6000
  const content = pageContent.length > maxLen ? pageContent.slice(0, maxLen) + "\n[truncated]" : pageContent

  const prompt = `You are an expert contact information extractor for professional events.

EVENT WE ARE FINDING CONTACT FOR: ${eventName}
PAGE TITLE: ${pageTitle}
PAGE URL: ${pageUrl}

PAGE CONTENT:
${content}

TASK:
Find the primary contact person for this specific event. Look for:
- Registration contact / Registration manager
- Event manager / Event coordinator
- Conference planner / Meeting planner
- CMP (Certified Meeting Planner)
- Lead retrieval contact
- Director of Sales for events
- Group sales manager
- Any person listed as the event organizer or point of contact

EXTRACT:
1. organizerName: Full name (first and last) of the contact person
2. organizerTitle: Their exact title/role
3. organizerEmail: Their email address
4. organizerPhone: Their phone number (include area code)

RULES:
- Only extract if you find a SPECIFIC PERSON's contact info on this page
- Do NOT extract generic venue phone numbers or info@ addresses
- The person must be associated with THIS specific event, not the venue generally
- If multiple contacts found, return the most senior/relevant one
- If no contact info found on this page, return null for all fields

KNOWN TITLES TO LOOK FOR:
Registration Manager, Event Manager, CMP, Certified Meeting Planner, Meeting Manager, Conference Planner, Lead Retrieval, Director of Sales, Group Sales Manager, Event Coordinator, Program Manager, VP of Events, Conference Director

RESPOND WITH VALID JSON ONLY:
{
  "organizerName": "First Last" or null,
  "organizerTitle": "Title" or null,
  "organizerEmail": "email@domain.com" or null,
  "organizerPhone": "123-456-7891" or null,
  "confidence": "high" | "medium" | "low",
  "sourceUrl": "${pageUrl}"
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
          { role: "system", content: "You are a precise contact extraction engine. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    })

    if (!res.ok) return null
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    if (!text) return null

    const parsed = JSON.parse(text)
    if (!parsed.organizerName) return null

    return {
      organizerName: parsed.organizerName,
      organizerTitle: parsed.organizerTitle,
      organizerEmail: parsed.organizerEmail,
      organizerPhone: parsed.organizerPhone,
      confidence: parsed.confidence ?? "medium",
      sourceUrl: pageUrl,
    }
  } catch {
    return null
  }
}

// ─── Multi-step contact search ────────────────────────────────────────────────

async function findContactsForEvent(
  eventName: string,
  sourceUrl: string | null,
  venueName: string
) {
  const results: {
    organizerName: string | null
    organizerTitle: string | null
    organizerEmail: string | null
    organizerPhone: string | null
    confidence: string
    sourceUrl: string
  }[] = []

  // STEP 1: Scrape the event's own source URL
  if (sourceUrl) {
    console.log(`[FindContact] Step 1: Scraping event page ${sourceUrl}`)
    let content = await scrapeUrl(sourceUrl)
    if (!content) {
      // Fall back to fetching via Tavily for content
      const tavilyResults = await searchTavily(`site:${sourceUrl}`)
      if (tavilyResults.length > 0) content = tavilyResults[0].content
    }
    if (content) {
      await sleep(500)
      const contact = await llmExtractContacts(content, eventName, sourceUrl, eventName)
      if (contact && contact.organizerName) {
        results.push(contact)
        if (contact.confidence === "high") return results
      }
    }
  }

  // STEP 2: Search for event contact/registration page
  await sleep(1000)
  console.log(`[FindContact] Step 2: Searching "${eventName}" contact registration`)
  const searchResults2 = await searchTavily(`"${eventName}" contact registration manager`)
  for (const r of searchResults2.slice(0, 3)) {
    let content = await scrapeUrl(r.url)
    if (!content) content = r.content
    await sleep(500)
    const contact = await llmExtractContacts(content, r.title, r.url, eventName)
    if (contact && contact.organizerName) {
      results.push(contact)
      if (contact.confidence === "high") return results
    }
  }

  // STEP 3: Search for venue staff directory
  await sleep(1000)
  console.log(`[FindContact] Step 3: Searching "${eventName}" ${venueName} staff`)
  const searchResults3 = await searchTavily(`"${eventName}" ${venueName} staff directory`)
  for (const r of searchResults3.slice(0, 3)) {
    let content = await scrapeUrl(r.url)
    if (!content) content = r.content
    await sleep(500)
    const contact = await llmExtractContacts(content, r.title, r.url, eventName)
    if (contact && contact.organizerName) {
      results.push(contact)
      if (contact.confidence === "high") return results
    }
  }

  // STEP 4: Broader search for organizer email/phone
  await sleep(1000)
  console.log(`[FindContact] Step 4: Searching "${eventName}" email phone organizer`)
  const searchResults4 = await searchTavily(`"${eventName}" email phone organizer planner`)
  for (const r of searchResults4.slice(0, 3)) {
    let content = await scrapeUrl(r.url)
    if (!content) content = r.content
    await sleep(500)
    const contact = await llmExtractContacts(content, r.title, r.url, eventName)
    if (contact && contact.organizerName) {
      results.push(contact)
      if (contact.confidence === "high") return results
    }
  }

  return results
}

// ─── Route: POST /api/events/[id]/find-contact ────────────────────────────────

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const event = await prisma.event.findUnique({
    where: { id },
    include: { location: { select: { name: true } } },
  })

  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 })
  }

  console.log(`\n[FindContact] Finding contacts for: ${event.eventName}`)

  const contacts = await findContactsForEvent(
    event.eventName,
    event.sourceUrl,
    event.location.name
  )

  // Deduplicate by email or name
  const seen = new Set<string>()
  const unique = contacts.filter((c) => {
    const key = (c.organizerEmail ?? c.organizerName ?? "").toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  console.log(`[FindContact] Found ${unique.length} unique contact(s)`)

  return NextResponse.json({
    eventId: event.id,
    eventName: event.eventName,
    contacts: unique,
  })
}
