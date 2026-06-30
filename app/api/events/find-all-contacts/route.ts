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
  if (!apiKey) return []

  const maxLen = 6000
  const content = pageContent.length > maxLen ? pageContent.slice(0, maxLen) + "\n[truncated]" : pageContent

  const prompt = `You are an expert contact information extractor for professional events.

EVENT WE ARE FINDING CONTACTS FOR: ${eventName}
PAGE TITLE: ${pageTitle}
PAGE URL: ${pageUrl}

PAGE CONTENT:
${content}

TASK:
Find ALL contact persons for this specific event mentioned on this page. Look for registration contacts, event managers, conference planners, CMP holders, lead retrieval contacts, directors of sales, group sales managers, program managers, or any person listed as the event organizer or point of contact.

EXTRACT EVERY PERSON FOUND. For each person, provide:
1. name: Full name (first and last)
2. title: Their exact title/role
3. email: Their email address
4. phone: Their phone number with area code

RULES:
- Extract ALL specific persons found, not just one
- Do NOT extract generic venue phone numbers or info@ addresses
- Each person must be associated with THIS specific event
- Return up to 10 contacts maximum
- If no contacts found, return empty array

RESPOND WITH VALID JSON ONLY:
{
  "contacts": [
    {
      "name": "First Last",
      "title": "Title" or null,
      "email": "email@domain.com" or null,
      "phone": "123-456-7891" or null,
      "confidence": "high" | "medium" | "low"
    }
  ]
}`

  try {
    const res = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://event-pipeline-dashboard.local", "X-OpenRouter-Title": "Event Pipeline Dashboard" },
      body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: "system", content: "You are a precise contact extraction engine. Respond with valid JSON only." }, { role: "user", content: prompt }], temperature: 0.1, max_tokens: 2000, response_format: { type: "json_object" } }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content
    if (!text) return []
    const parsed = JSON.parse(text)
    const contacts = parsed.contacts ?? []
    return contacts
      .filter((c: { name?: string }) => c.name && c.name.length > 2)
      .map((c: { name: string; title?: string; email?: string; phone?: string; confidence?: string }) => ({
        name: c.name, title: c.title ?? null, email: c.email ?? null,
        phone: c.phone ?? null, confidence: c.confidence ?? "medium", sourceUrl: pageUrl,
      }))
  } catch { return [] }
}

async function findContactsForEvent(eventName: string, sourceUrl: string | null, venueName: string) {
  const allContacts: { name: string; title: string | null; email: string | null; phone: string | null; confidence: string; sourceUrl: string }[] = []

  // Step 1: Event page itself (most specific)
  if (sourceUrl) {
    let content = await scrapeUrl(sourceUrl)
    if (!content) { const r = await searchTavily(`site:${sourceUrl}`); if (r.length > 0) content = r[0].content }
    if (content) { await sleep(500); const c = await llmExtractContacts(content, eventName, sourceUrl, eventName); allContacts.push(...c) }
  }
  // Step 2: Event-specific registration/contact search
  await sleep(1000)
  const r2 = await searchTavily(`"${eventName}" contact registration manager`)
  for (const r of r2.slice(0, 3)) { let c = await scrapeUrl(r.url); if (!c) c = r.content; await sleep(500); const contacts = await llmExtractContacts(c, r.title, r.url, eventName); allContacts.push(...contacts) }
  // Step 3: Event-specific organizer search
  await sleep(1000)
  const r3 = await searchTavily(`"${eventName}" email phone organizer planner`)
  for (const r of r3.slice(0, 3)) { let c = await scrapeUrl(r.url); if (!c) c = r.content; await sleep(500); const contacts = await llmExtractContacts(c, r.title, r.url, eventName); allContacts.push(...contacts) }
  // Step 4 (fallback): Venue staff directory — only if no event-specific contacts found
  if (allContacts.length === 0) {
    await sleep(1000)
    const r4 = await searchTavily(`"${eventName}" ${venueName} staff directory`)
    for (const r of r4.slice(0, 3)) { let c = await scrapeUrl(r.url); if (!c) c = r.content; await sleep(500); const contacts = await llmExtractContacts(c, r.title, r.url, eventName); allContacts.push(...contacts) }
  }

  // Deduplicate by email or name+title
  const seen = new Set<string>()
  return allContacts.filter((c) => {
    const key = c.email ? c.email.toLowerCase() : `${c.name.toLowerCase()}|${(c.title ?? "").toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function POST() {
  const events = await prisma.event.findMany({
    where: { organizerName: null },
    include: { location: { select: { name: true } }, contacts: true },
    orderBy: { eventDateStart: "asc" },
    take: 20,
  })

  if (events.length === 0) {
    return NextResponse.json({ message: "No events missing contacts", processed: 0, found: 0 })
  }

  console.log(`\n[FindAll] Processing ${events.length} events missing contacts`)

  let totalFound = 0
  for (let i = 0; i < events.length; i++) {
    const event = events[i]
    console.log(`[FindAll] ${i + 1}/${events.length}: ${event.eventName}`)

    const foundContacts = await findContactsForEvent(event.eventName, event.sourceUrl, event.location.name)

    // Save to EventContact table, skip existing
    const existingEmails = new Set(event.contacts.filter((c) => c.email).map((c) => c.email!.toLowerCase()))
    const existingNames = new Set(event.contacts.map((c) => c.name.toLowerCase()))
    let saved = 0

    for (const c of foundContacts) {
      const emailKey = c.email?.toLowerCase()
      const nameKey = c.name.toLowerCase()
      if (emailKey && existingEmails.has(emailKey)) continue
      if (existingNames.has(nameKey)) continue

      const isFirst = event.contacts.length === 0 && saved === 0

      await prisma.eventContact.create({
        data: {
          eventId: event.id, name: c.name, title: c.title, email: c.email,
          phone: c.phone, isPrimary: isFirst, sourceUrl: c.sourceUrl, confidence: c.confidence,
        },
      })

      // Populate legacy single-contact fields for first primary
      if (isFirst) {
        await prisma.event.update({
          where: { id: event.id },
          data: { organizerName: c.name, organizerTitle: c.title, organizerEmail: c.email, organizerPhone: c.phone },
        })
      }

      existingEmails.add(emailKey ?? "")
      existingNames.add(nameKey)
      saved++
    }

    totalFound += saved
    console.log(`[FindAll] Found ${saved} new contacts`)
  }

  console.log(`[FindAll] Complete: ${totalFound} total new contacts across ${events.length} events`)

  return NextResponse.json({
    message: `Processed ${events.length} events, found ${totalFound} contacts`,
    processed: events.length,
    found: totalFound,
  })
}
