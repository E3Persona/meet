import { canUseProvider, trackUsage } from "@/lib/providers/credit-tracker"

export interface VenueEventLLM {
  eventName: string | null
  eventDateStart: string | null
  eventDateEnd: string | null
  sourceUrl: string | null
  city: string | null
  confidence: "high" | "medium" | "low"
}

let _allLLMFailed = false
let _last429At = 0

async function waitForRateLimit(): Promise<void> {
  const elapsed = Date.now() - _last429At
  if (elapsed < 65000) {
    const wait = 65000 - elapsed
    console.warn(`[llm] waiting ${Math.round(wait / 1000)}s for rate limit...`)
    await new Promise((r) => setTimeout(r, wait))
  }
}

async function callLLM(
  prompt: string,
  model: string,
  maxTokens: number,
  provider: "groq" | "openrouter"
): Promise<string | null> {
  if (_allLLMFailed) return null

  const baseUrl = provider === "groq"
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://openrouter.ai/api/v1/chat/completions"
  const apiKey = provider === "groq"
    ? process.env.GROQ_API_KEY
    : process.env.OPENROUTER_API_KEY

  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await waitForRateLimit()
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a precise event data extraction engine. Always respond with valid JSON only." },
            { role: "user", content: prompt },
          ],
          temperature: 0.1,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(120000),
      })
      if (res.ok) {
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content
        if (content) {
          trackUsage(provider, "llm", data.usage?.totalTokens)
          return content
        }
      }
      if (res.status === 429) {
        _last429At = Date.now()
        console.warn(`[llm] ${provider} 429 attempt ${attempt + 1}, retrying...`)
        continue
      }
      console.warn(`[llm] ${provider} error:`, res.status, (await res.text().catch(() => "")).slice(0, 100))
      if (provider !== "groq") _allLLMFailed = true
      return null
    } catch (err) {
      console.warn(`[llm] ${provider} call failed:`, err instanceof Error ? err.message : err)
      if (attempt < 2) continue
      return null
    }
  }
  return null
}

function extractJSONList(content: string): Record<string, unknown>[] | null {
  try {
    const parsed = JSON.parse(content.replace(/```(?:json)?\s*/g, "").trim())
    return (parsed?.events as Record<string, unknown>[]) ?? null
  } catch {
    return null
  }
}

export async function extractVenueEvents(
  blockText: string,
  pageUrl: string,
  venueName?: string,
  dateHint?: string | null,
  cityHint?: string | null,
  eventNameHint?: string | null
): Promise<VenueEventLLM[]> {
  const truncated = blockText.length > 4000 ? blockText.slice(0, 4000) + "\n\n[Content truncated...]" : blockText
  const venueCtx = venueName ? `\nVenue: ${venueName}` : ""
  const dateCtx = dateHint ? `\nListing page date context: ${dateHint}` : ""
  const cityCtx = cityHint ? `\nCity: ${cityHint}` : ""
  const nameCtx = eventNameHint ? `\nExpected event name (from URL slug or detail page): ${eventNameHint}` : ""

  const prompt = `Extract events from this venue events listing page.

Return JSON: {"events":[{"eventName"(string|null),"eventDateStart"(ISO YYYY-MM-DD|null),"eventDateEnd"(ISO YYYY-MM-DD|null),"sourceUrl"(string|null),"city"(string|null),"confidence"("high"|"medium"|"low")}]}

${venueCtx}${dateCtx}${cityCtx}${nameCtx}
Page: ${pageUrl}

Content:
${truncated}

Rules:
- Only conferences/conventions/tradeshows/meetings — NOT hotel room bookings or promotions
- Event names: look in the link's title attribute text (e.g. "More Info for 3DPrintopia"), the URL slug, AND visible page text
- If the listing has generic placeholder text (e.g. "Update: July Board of Directors Meeting" reused for every event), IGNORE that and use the slug-derived name if provided
- Dates: if you see a date range like "July 23 - 30 / 2026" or "July 23-30, 2026" on the listing page, use that as eventDateStart/eventDateEnd
- "Event Starts 6:00 AM" alone is just a time — use actual calendar dates from the page
- For convention center venues: city is the city the convention center is in
- If no real event name (just "Update", "Register", generic text) → eventName = null
- Dates required (eventDateStart needed for a valid event) — if no date on listing, check the detail URL slug or return null eventName
- Return null eventName if no valid event found`

  const providers: [string, string, number][] = [
    ["groq", "llama-3.3-70b-versatile", 1500],
  ]

  for (const [provider, model, maxTokens] of providers) {
    const check = canUseProvider(provider)
    if (!check.allowed) continue
    const content = await callLLM(prompt, model, maxTokens, provider as "groq" | "openrouter")
    if (!content) continue
    const events = extractJSONList(content)
    if (events) {
      return events.map((e) => ({
        eventName: (e.eventName as string) ?? null,
        eventDateStart: (e.eventDateStart as string) ?? null,
        eventDateEnd: (e.eventDateEnd as string) ?? null,
        sourceUrl: (e.sourceUrl as string) ?? null,
        city: (e.city as string) ?? cityHint ?? null,
        confidence: (e.confidence as "high" | "medium" | "low") ?? "low",
      }))
    }
  }

  return [{ eventName: null, eventDateStart: null, eventDateEnd: null, sourceUrl: null, city: cityHint ?? null, confidence: "low" }]
}

export interface DetailPageEvent {
  url: string
  eventName: string | null
  eventDateStart: string | null
  eventDateEnd: string | null
}

export async function extractDetailPageEvents(
  pages: { url: string; markdown: string }[]
): Promise<DetailPageEvent[]> {
  if (pages.length === 0) return []

  const batches: { url: string; markdown: string }[][] = []
  for (let i = 0; i < pages.length; i += 10) {
    batches.push(pages.slice(i, i + 10))
  }

  const results: DetailPageEvent[] = []

  for (const batch of batches) {
    const items = batch.map((p) => {
      const truncated = p.markdown.length > 1200 ? p.markdown.slice(0, 1200) + "\n..." : p.markdown
      return `URL: ${p.url}\nContent:\n${truncated}`
    }).join("\n\n---\n\n")

    const prompt = `Extract the event name and date range from each detail page below.

Return JSON: {"events":[{"url"(string),"eventName"(string|null),"eventDateStart"(ISO YYYY-MM-DD|null),"eventDateEnd"(ISO YYYY-MM-DD|null)}]}

${items}

Rules:
- eventName: use the H1 or first prominent heading as the event name
- eventDateStart/eventDateEnd: extract the actual event date range, not today's date or "Posted" dates
- If no date found, set both to null
- One entry per URL, even if no event found`

    let parsed: DetailPageEvent[] | null = null

    const groqCheck = canUseProvider("groq")
    if (groqCheck.allowed) {
      const content = await callLLM(prompt, "llama-3.3-70b-versatile", 2000, "groq")
      if (content) {
        const events = extractJSONList(content)
        if (events) {
          parsed = events.map((e) => ({
            url: (e.url as string) ?? "",
            eventName: (e.eventName as string) ?? null,
            eventDateStart: (e.eventDateStart as string) ?? null,
            eventDateEnd: (e.eventDateEnd as string) ?? null,
          }))
        }
      }
    }

    if (parsed) {
      results.push(...parsed)
    } else {
      for (const p of batch) {
        results.push({ url: p.url, eventName: null, eventDateStart: null, eventDateEnd: null })
      }
    }
  }

  return results
}
