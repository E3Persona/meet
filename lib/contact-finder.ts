const TAVILY_API_URL = "https://api.tavily.com/search"
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"
const LLM_MODEL = "google/gemini-2.5-flash"

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ─── Jina AI Reader: free markdown extraction ──────────────────────────────

export async function fetchViaJina(url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Accept: "text/markdown", "X-No-Cache": "true" },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const text = await res.text()
    return text || null
  } catch {
    return null
  }
}

// ─── Firecrawl fallback ────────────────────────────────────────────────────

async function fetchViaFirecrawl(url: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
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

// ─── Combined fetch: Jina first, Firecrawl fallback ────────────────────────

export async function fetchPageMarkdown(url: string): Promise<string | null> {
  const jina = await fetchViaJina(url)
  if (jina) return jina
  return fetchViaFirecrawl(url)
}

// ─── Tavily search ─────────────────────────────────────────────────────────

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

// ─── LLM: extract contacts from page content ──────────────────────────────

async function llmExtractContacts(
  pageContent: string,
  pageTitle: string,
  pageUrl: string,
  eventName: string
): Promise<{
  name: string
  title: string | null
  email: string | null
  phone: string | null
  confidence: string
  sourceUrl: string
}[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return []

  const maxLen = 6000
  const content = pageContent.length > maxLen
    ? pageContent.slice(0, maxLen) + "\n[truncated]"
    : pageContent

  const prompt = `You are an expert contact information extractor for professional events.

EVENT WE ARE FINDING CONTACTS FOR: ${eventName}
PAGE TITLE: ${pageTitle}
PAGE URL: ${pageUrl}

PAGE CONTENT:
${content}

TASK:
Find ALL contact persons for this specific event mentioned on this page. Look for:
- Registration contacts / Registration managers
- Event managers / Event coordinators
- Conference planners / Meeting planners
- CMPs (Certified Meeting Planners)
- Lead retrieval contacts
- Director of Sales for events
- Group sales managers
- Program managers
- Any person listed as an event organizer or point of contact

EXTRACT EVERY PERSON FOUND. For each person, provide:
1. name: Full name (first and last)
2. title: Their exact title/role
3. email: Their email address
4. phone: Their phone number (include area code)

RULES:
- Extract ALL specific persons found, not just one
- Do NOT extract generic venue phone numbers or info@ addresses
- Each person must be associated with THIS specific event, not the venue generally
- If no contact info found on this page, return an empty array
- Return up to 10 contacts maximum

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
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
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
        name: c.name,
        title: c.title ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        confidence: c.confidence ?? "medium",
        sourceUrl: pageUrl,
      }))
  } catch {
    return []
  }
}

// ─── Main: find contacts for one event ─────────────────────────────────────

export type ContactResult = {
  name: string
  title: string | null
  email: string | null
  phone: string | null
  confidence: string
  sourceUrl: string
}

export async function findContactsForEvent(
  eventName: string,
  sourceUrl: string | null,
  venueName: string
): Promise<ContactResult[]> {
  const allContacts: ContactResult[] = []

  // STEP 1: Scrape the event's own source URL (most relevant — always first)
  if (sourceUrl) {
    console.log(`[FindContact] Step 1: Fetching event page ${sourceUrl}`)
    let content = await fetchPageMarkdown(sourceUrl)
    if (content) {
      await sleep(500)
      const contacts = await llmExtractContacts(content, eventName, sourceUrl, eventName)
      allContacts.push(...contacts)
      console.log(`[FindContact] Step 1: Found ${contacts.length} contacts from source URL`)
    } else {
      console.log(`[FindContact] Step 1: Could not fetch source URL, trying Tavily`)
      const tavilyFallback = await searchTavily(`site:${sourceUrl}`)
      if (tavilyFallback.length > 0) {
        const content2 = tavilyFallback[0].content
        await sleep(500)
        const contacts = await llmExtractContacts(content2, eventName, sourceUrl, eventName)
        allContacts.push(...contacts)
        console.log(`[FindContact] Step 1: Found ${contacts.length} contacts from Tavily fallback`)
      }
    }
  }

  // STEP 2: Search for event-specific contact/registration page
  await sleep(1000)
  console.log(`[FindContact] Step 2: Searching "${eventName}" contact registration`)
  const searchResults2 = await searchTavily(`"${eventName}" contact registration manager`)
  for (const r of searchResults2.slice(0, 3)) {
    let content = await fetchPageMarkdown(r.url)
    if (!content) content = r.content
    await sleep(500)
    const contacts = await llmExtractContacts(content, r.title, r.url, eventName)
    allContacts.push(...contacts)
  }

  // STEP 3: Search for event-specific organizer email/phone
  await sleep(1000)
  console.log(`[FindContact] Step 3: Searching "${eventName}" email phone organizer`)
  const searchResults3 = await searchTavily(`"${eventName}" email phone organizer planner`)
  for (const r of searchResults3.slice(0, 3)) {
    let content = await fetchPageMarkdown(r.url)
    if (!content) content = r.content
    await sleep(500)
    const contacts = await llmExtractContacts(content, r.title, r.url, eventName)
    allContacts.push(...contacts)
  }

  // STEP 4 (fallback): Venue staff directory — only if no event-specific contacts found
  if (allContacts.length === 0) {
    await sleep(1000)
    console.log(`[FindContact] Step 4: Fallback — searching venue "${venueName}" staff`)
    const searchResults4 = await searchTavily(`"${eventName}" ${venueName} staff directory`)
    for (const r of searchResults4.slice(0, 3)) {
      let content = await fetchPageMarkdown(r.url)
      if (!content) content = r.content
      await sleep(500)
      const contacts = await llmExtractContacts(content, r.title, r.url, eventName)
      allContacts.push(...contacts)
    }
  }

  // Deduplicate by email or name+title
  const seen = new Set<string>()
  return allContacts.filter((c) => {
    const key = c.email
      ? c.email.toLowerCase()
      : `${c.name.toLowerCase()}|${(c.title ?? "").toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ─── Save contacts to DB ───────────────────────────────────────────────────

export async function saveContacts(
  prisma: any,
  eventId: string,
  existingContacts: { email?: string | null; name: string }[],
  foundContacts: ContactResult[],
  sourceUrl: string | null
): Promise<number> {
  const existingEmails = new Set(
    existingContacts.filter((c) => c.email).map((c) => c.email!.toLowerCase())
  )
  const existingNames = new Set(existingContacts.map((c) => c.name.toLowerCase()))

  let saved = 0
  for (const c of foundContacts) {
    const emailKey = c.email?.toLowerCase()
    const nameKey = c.name.toLowerCase()
    if (emailKey && existingEmails.has(emailKey)) continue
    if (existingNames.has(nameKey)) continue

    const isFirst = existingContacts.length === 0 && saved === 0

    await prisma.eventContact.create({
      data: {
        eventId,
        name: c.name,
        title: c.title,
        email: c.email,
        phone: c.phone,
        isPrimary: isFirst,
        sourceUrl: c.sourceUrl,
        confidence: c.confidence,
      },
    })

    if (isFirst) {
      await prisma.event.update({
        where: { id: eventId },
        data: {
          organizerName: c.name,
          organizerTitle: c.title,
          organizerEmail: c.email,
          organizerPhone: c.phone,
        },
      })
    }

    existingEmails.add(emailKey ?? "")
    existingNames.add(nameKey)
    saved++
  }

  return saved
}
