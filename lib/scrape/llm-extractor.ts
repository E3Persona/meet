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
  sourceUrl: string | null
  confidence: "high" | "medium" | "low"
  reason: string
  contacts?: LlmContact[]
}

export interface LlmExtractionResult {
  events: LlmExtractedEvent[]
}

async function callLlm(prompt: string): Promise<LlmExtractionResult> {
  // Prefer Ollama (local, free, no token limits)
  const ollamaBase = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434"
  try {
    console.log(`[LLM] Calling Ollama at ${ollamaBase}...`)
    const res = await fetch(`${ollamaBase}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "llama3.2",
        messages: [
          { role: "system", content: "You are a precise event data extraction engine. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 600,
      }),
      signal: AbortSignal.timeout(120000),
    })
    if (res.ok) {
      const data = await res.json()
      const content = data.choices?.[0]?.message?.content
      if (content) {
        const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()
        const parsed = JSON.parse(cleaned)
        console.log(`[LLM] Ollama returned ${parsed.events?.length ?? 0} events`)
        return { events: parsed.events ?? [] }
      }
    }
    console.log(`[LLM] Ollama ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  } catch (err) {
    console.log(`[LLM] Ollama unavailable:`, err instanceof Error ? err.message : err)
  }

  // Fallback: OpenRouter
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { events: [] }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.2-3b-instruct",
        messages: [
          { role: "system", content: "You are a precise event data extraction engine. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 300,
      }),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[LLM] OpenRouter ${res.status}: ${text.slice(0, 200)}`)
      return { events: [] }
    }
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return { events: [] }
    const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)
    return { events: parsed.events ?? [] }
  } catch (err) {
    console.error(`[LLM] OpenRouter error:`, err instanceof Error ? err.message : err)
    return { events: [] }
  }
}

export async function extractEventsWithLLM(
  pageContent: string,
  pageTitle: string,
  pageUrl: string,
  locationName?: string,
  searchMonth?: string,
  sourceNotes?: string | null
): Promise<LlmExtractionResult> {
  const maxContentLength = 6000
  const truncatedContent =
    pageContent.length > maxContentLength
      ? pageContent.slice(0, maxContentLength) + "\n\n[Content truncated...]"
      : pageContent

  const locationContext = locationName
    ? `- Location: ${locationName}`
    : ""
  const monthContext = searchMonth
    ? `- Month: ${searchMonth}`
    : ""

  const sourceInstructions = sourceNotes
    ? `\nSOURCE-SITE INSTRUCTIONS:\n${sourceNotes}\n`
    : ""

  const contactsInstr = locationName
    ? `"contacts":[{"name"(string),"title"(string|null),"email"(string|null),"phone"(string|null)}]`
    : ""

  const prompt = `Extract events from this page.

${locationContext}
${monthContext}
Page: ${pageTitle} (${pageUrl})
${sourceInstructions}

Content:
${truncatedContent}

Return JSON: {"events":[{"eventName"(string),"eventDateStart"(ISO date or null),"eventDateEnd"(ISO or null),"sourceUrl"(detail URL or null),"confidence"("high"/"medium"/"low"),"reason"(string)${locationName ? `,${contactsInstr}` : ""}]}

Rules: Only meetings/conventions/tradeshows/conferences. Include year in name. Use detail URL if linked. Empty array if none.`

  return callLlm(prompt)
}
