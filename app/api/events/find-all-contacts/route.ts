import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

const TAVILY_API_URL = "https://api.tavily.com/search"
const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape"
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const LLM_MODEL = "google/gemini-2.5-flash"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function searchTavily(query: string) {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey, query, search_depth: "advanced", max_results: 5 }),
    })
    if (!res.ok) return []
    const data = await res.json()
    return data.results ?? []
  } catch { return [] }
}

async function scrapeUrl(url: string) {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(FIRECRAWL_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.data?.markdown ?? null
  } catch { return null }
}

async function llmExtractContacts(pageContent: string, pageTitle: string, pageUrl: string, eventName: string) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return null

  const maxLen = 6000
  const content = pageContent.length > maxLen ? pageContent.slice(0, maxLen) + "\n[truncated]" : pageContent

  const prompt = `You are an expert contact information extractor for professional events.

EVENT: ${eventName}
PAGE: ${pageTitle} (${pageUrl})

CONTENT:
${content}

Find the primary contact person for this event. Look for registration contacts, event managers, conference planners, CMP holders, lead retrieval contacts, directors of sales, or any person listed as the event organizer.

EXTRACT:
- organizerName: Full name (first and last)
- organizerTitle: Their exact title/role
- organizerEmail: Their email address
- organizerPhone: Their phone number with area code

Only extract if you find a SPECIFIC PERSON's info. Do NOT extract generic venue numbers or info@ addresses.

KNOWN TITLES: Registration Manager, Event Manager, CMP, Meeting Manager, Conference Planner, Lead Retrieval, Director of Sales, Group Sales Manager, Event Coordinator

RESPOND WITH VALID JSON ONLY:
{"organizerName":"..." or null,"organizerTitle":"..." or null,"organizerEmail":"..." or null,"organizerPhone":"..." or null,"confidence":"high"|"medium"|"low"}`

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://event-pipeline-dashboard.local", "X-OpenRouter-Title": "Event Pipeline Dashboard" },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: "system", content: "You are a precise contact extraction engine. Respond with valid JSON only." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 500, response_format: { type: "json_object" } }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    if (!text) return null
    const parsed = JSON.parse(text)
    if (!parsed.organizerName) return null
    return parsed
  } catch { return null }
}

async function findContactsForEvent(eventName: string, sourceUrl: string | null, venueName: string) {
  // Step 1: Event page itself
  if (sourceUrl) {
    let content = await scrapeUrl(sourceUrl)
    if (!content) { const r = await searchTavily(`site:${sourceUrl}`); if (r.length > 0) content = r[0].content }
    if (content) { await sleep(500); const c = await llmExtractContacts(content, eventName, sourceUrl, eventName); if (c?.organizerName) return c }
  }
  // Step 2
  await sleep(1000)
  const r2 = await searchTavily(`"${eventName}" contact registration manager`)
  for (const r of r2.slice(0, 3)) { let c = await scrapeUrl(r.url); if (!c) c = r.content; await sleep(500); const contact = await llmExtractContacts(c, r.title, r.url, eventName); if (contact?.organizerName) return contact }
  // Step 3
  await sleep(1000)
  const r3 = await searchTavily(`"${eventName}" ${venueName} staff directory`)
  for (const r of r3.slice(0, 3)) { let c = await scrapeUrl(r.url); if (!c) c = r.content; await sleep(500); const contact = await llmExtractContacts(c, r.title, r.url, eventName); if (contact?.organizerName) return contact }
  // Step 4
  await sleep(1000)
  const r4 = await searchTavily(`"${eventName}" email phone organizer planner`)
  for (const r of r4.slice(0, 3)) { let c = await scrapeUrl(r.url); if (!c) c = r.content; await sleep(500); const contact = await llmExtractContacts(c, r.title, r.url, eventName); if (contact?.organizerName) return contact }

  return null
}

export async function POST() {
  const events = await prisma.event.findMany({
    where: { organizerName: null },
    include: { location: { select: { name: true } } },
    orderBy: { eventDateStart: "asc" },
    take: 20,
  })

  if (events.length === 0) {
    return NextResponse.json({ message: "No events missing contacts", processed: 0, found: 0 })
  }

  console.log(`\n[FindAll] Processing ${events.length} events missing contacts`)

  let found = 0
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    console.log(`[FindAll] ${i + 1}/${events.length}: ${event.eventName}`)

    const contact = await findContactsForEvent(event.eventName, event.sourceUrl, event.location.name)
    if (contact && contact.organizerName) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          organizerName: contact.organizerName,
          organizerTitle: contact.organizerTitle || null,
          organizerEmail: contact.organizerEmail || null,
          organizerPhone: contact.organizerPhone || null,
        },
      })
      found++
      console.log(`[FindAll] Found: ${contact.organizerName} (${contact.organizerTitle ?? "no title"})`)
    }
  }

  console.log(`[FindAll] Complete: ${found}/${events.length} contacts found`)

  return NextResponse.json({
    message: `Processed ${events.length} events, found ${found} contacts`,
    processed: events.length,
    found,
  })
}
