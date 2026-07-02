export interface LlmContact {
  name: string
  title: string | null
  email: string | null
  phone: string | null
  confidence: string
}

export interface LlmExtractedEvent {
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  confidence: "high" | "medium" | "low"
  reason: string
  contacts?: LlmContact[]
}

export interface LlmExtractionResult {
  events: LlmExtractedEvent[]
}

export async function extractEventsWithLLM(
  pageContent: string,
  pageTitle: string,
  pageUrl: string,
  locationName?: string,
  searchMonth?: string,
  sourceNotes?: string | null
): Promise<LlmExtractionResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { events: [] }

  const maxContentLength = 8000
  const truncatedContent =
    pageContent.length > maxContentLength
      ? pageContent.slice(0, maxContentLength) + "\n\n[Content truncated...]"
      : pageContent

  const locationContext = locationName
    ? `- We are searching for events at: ${locationName}`
    : ""
  const monthContext = searchMonth
    ? `- Focus month: ${searchMonth}`
    : ""

  const sourceInstructions = sourceNotes
    ? `\nSOURCE-SITE INSTRUCTIONS:\n${sourceNotes}\n`
    : ""

  const contactsInstr = locationName
    ? `6. contacts: Array of contact persons found for THIS specific event on this page

FOR EACH CONTACT (per event):
- name: Full name (first and last) of a person associated with this specific event
- title: Their exact title/role (e.g. Event Manager, Registration Contact, Director of Sales)
- email: Their email address
- phone: Their phone number with area code

CONTACT RULES:
- Only extract SPECIFIC PERSONS linked to THIS event, not generic venue staff
- Do NOT extract info@ or generic venue numbers
- Look for: registration contacts, event managers, conference planners, CMP holders, directors of sales, group sales managers, program managers
- If no contacts found for an event, return empty array for that event's contacts
- You may find 0-5 contacts per event`
    : ""

  const prompt = `You are an expert event data extractor specializing in Meetings, Conventions, Tradeshows, Conferences, and Expos.

CONTEXT:
${locationContext}
${monthContext}
- Page title: ${pageTitle}
- Page URL: ${pageUrl}
${sourceInstructions}
PAGE CONTENT:
${truncatedContent}

TASK:
Extract ALL events/conferences/tradeshows mentioned on this page.

FOR EACH EVENT, provide:
1. eventName: The full, accurate name of the event
2. eventDateStart: Start date in ISO format (YYYY-MM-DD) if found, null if not
3. eventDateEnd: End date in ISO format (YYYY-MM-DD) if found, null if not
4. confidence: "high" if clearly stated, "medium" if partially clear, "low" if inferred
5. reason: Brief note on where/how you found this event
${contactsInstr}

EVENT RULES:
- Be precise with event names — include year, full title
- Only extract meetings, conventions, tradeshows, conferences, expos, summits, forums, shows
- Extract ALL events listed on the page, not just the first few
- Do NOT extract venue info, restaurant listings, general tourism
- Return empty array if no relevant events found

RESPOND WITH VALID JSON ONLY:
{
  "events": [
    {
      "eventName": "...",
      "eventDateStart": "YYYY-MM-DD" or null,
      "eventDateEnd": "YYYY-MM-DD" or null,
      "confidence": "high" | "medium" | "low",
      "reason": "...",${locationName ? `
      "contacts": []` : ""}
    }
  ]
}`

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://event-pipeline-dashboard.local",
        "X-OpenRouter-Title": "Event Pipeline Dashboard",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You are a precise event data extraction engine. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
    })

    if (!res.ok) return { events: [] }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return { events: [] }
    const parsed = JSON.parse(content)
    return { events: parsed.events ?? [] }
  } catch {
    return { events: [] }
  }
}
