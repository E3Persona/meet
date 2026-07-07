import { canUseProvider, trackUsage, DEV_MODE } from "@/lib/providers/credit-tracker"

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

// Groq rate limiter (minute-level — prevents 429 from API throughput, not credit budget)
const GROQ_LIMITS = {
  requestsPerMinute: 30,
  tokensPerMinute: 12000,
}

class GroqRateLimiter {
  private requestTimestamps: number[] = []
  private minuteTokensUsed = 0
  private lastMinuteReset = Date.now()

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()

    if (now - this.lastMinuteReset > 60 * 1000) {
      this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60 * 1000)
      this.minuteTokensUsed = 0
      this.lastMinuteReset = now
    }

    if (this.requestTimestamps.length >= GROQ_LIMITS.requestsPerMinute) {
      const oldestTimestamp = this.requestTimestamps[0]
      const waitMs = oldestTimestamp + 60 * 1000 - now
      console.log(`[Groq Rate Limiter] Minute request limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }
    if (this.minuteTokensUsed >= GROQ_LIMITS.tokensPerMinute) {
      const waitMs = this.lastMinuteReset + 60 * 1000 - now
      console.log(`[Groq Rate Limiter] Minute token limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }
  }

  recordRequest(tokensUsed: number): void {
    const now = Date.now()
    this.requestTimestamps.push(now)
    this.minuteTokensUsed += tokensUsed
  }
}

const groqRateLimiter = new GroqRateLimiter()

// OpenRouter rate limiter (minute-level only)
class OpenRouterRateLimiter {
  private requestTimestamps: number[] = []

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60 * 1000)

    if (this.requestTimestamps.length >= 20) {
      const oldestTimestamp = this.requestTimestamps[0]
      const waitMs = oldestTimestamp + 60 * 1000 - now
      console.log(`[OpenRouter Rate Limiter] Minute request limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }
  }

  recordRequest(): void {
    this.requestTimestamps.push(Date.now())
  }

  async handleRateLimit(res: Response): Promise<boolean> {
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get("Retry-After"))
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        console.log(`[OpenRouter Rate Limiter] Server returned ${res.status}, waiting ${retryAfter}s per Retry-After header`)
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000))
        return true
      }
    }
    return false
  }
}

const openRouterRateLimiter = new OpenRouterRateLimiter()

async function callLlm(prompt: string, _attempt = 0): Promise<LlmExtractionResult> {
  // Groq (primary)
  const apiKey = process.env.GROQ_API_KEY
  if (apiKey) {
    const groqCheck = canUseProvider("groq")
    if (!groqCheck.allowed) {
      console.log(`[LLM] ${groqCheck.reason}`)
    } else {
      try {
        await groqRateLimiter.waitIfNeeded()
        console.log(`[LLM] Calling Groq with llama-3.3-70b-versatile...`)
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              { role: "system", content: "You are a precise event data extraction engine. Always respond with valid JSON only." },
              { role: "user", content: prompt },
            ],
            temperature: 0.1,
            max_tokens: 1500,
          }),
          signal: AbortSignal.timeout(120000),
        })
        if (res.ok) {
          const data = await res.json()
          const content = data.choices?.[0]?.message?.content
          const finishReason = data.choices?.[0]?.finish_reason
          const tokensUsed = data.usage?.total_tokens ?? 0
          groqRateLimiter.recordRequest(tokensUsed)
          trackUsage("groq", "llm", tokensUsed)
          if (content) {
            if (finishReason === "length") {
              console.log(`[LLM] Groq response truncated (finish_reason=length), attempting salvage...`)
              return salvageTruncatedJson(content)
            }
            const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()
            try {
              const parsed = JSON.parse(cleaned)
              console.log(`[LLM] Groq returned ${parsed.events?.length ?? 0} events (${tokensUsed} tokens)`)
              return { events: parsed.events ?? [] }
            } catch {
              console.log(`[LLM] Groq JSON parse failed, attempting salvage...`)
              return salvageTruncatedJson(content)
            }
          }
        }
        console.log(`[LLM] Groq ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
      } catch (err) {
        console.log(`[LLM] Groq error:`, err instanceof Error ? err.message : err)
      }
    }
  }

  // Fallback: OpenRouter (only retry once)
  if (_attempt > 0) {
    console.log(`[LLM] OpenRouter already attempted, giving up`)
    return { events: [] }
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!openRouterKey) return { events: [] }

  const orCheck = canUseProvider("openrouter")
  if (!orCheck.allowed) {
    console.log(`[LLM] ${orCheck.reason}`)
    return { events: [] }
  }

  try {
    await openRouterRateLimiter.waitIfNeeded()
    console.log(`[LLM] Calling OpenRouter with meta-llama/llama-3.2-3b-instruct...`)
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openRouterKey}`,
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.2-3b-instruct:free",
        messages: [
          { role: "system", content: "You are a precise event data extraction engine. Always respond with valid JSON only." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 800,
      }),
    })

    if (await openRouterRateLimiter.handleRateLimit(res)) {
      console.log(`[LLM] OpenRouter rate limited, skipping`)
      return { events: [] }
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[LLM] OpenRouter ${res.status}: ${text.slice(0, 200)}`)
      return { events: [] }
    }

    openRouterRateLimiter.recordRequest()
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    const tokensUsed = data.usage?.total_tokens ?? 0
    trackUsage("openrouter", "llm", tokensUsed)
    if (!content) return { events: [] }
    const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)
    console.log(`[LLM] OpenRouter returned ${parsed.events?.length ?? 0} events (${tokensUsed} tokens)`)
    return { events: parsed.events ?? [] }
  } catch (err) {
    console.error(`[LLM] OpenRouter error:`, err instanceof Error ? err.message : err)
    return { events: [] }
  }
}

function salvageTruncatedJson(content: string): LlmExtractionResult {
  // Try to extract events array from truncated JSON
  // Find the last complete event object by looking for the last closing brace
  const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()

  // Try progressively smaller slices to find valid JSON
  for (let i = cleaned.length; i > 0; i--) {
    const slice = cleaned.slice(0, i)
    // Try closing the JSON structure
    const attempts = [
      slice + ']}',
      slice + '"}]}',
      slice + '""}]}',
      slice + ',"reason":""}]}',
    ]
    for (const attempt of attempts) {
      try {
        const parsed = JSON.parse(attempt)
        if (parsed.events && Array.isArray(parsed.events)) {
          console.log(`[LLM] Salvaged ${parsed.events.length} events from truncated response`)
          return { events: parsed.events }
        }
      } catch {
        // continue
      }
    }
  }

  // Last resort: regex extract event names and dates
  const nameMatches = [...cleaned.matchAll(/"eventName"\s*:\s*"([^"]+)"/g)]
  const dateMatches = [...cleaned.matchAll(/"eventDateStart"\s*:\s*"([^"]+)"/g)]
  if (nameMatches.length > 0) {
    const events: LlmExtractedEvent[] = nameMatches.map((m, i) => ({
      eventName: m[1],
      eventDateStart: dateMatches[i]?.[1] ?? null,
      eventDateEnd: null,
      sourceUrl: null,
      confidence: "medium" as const,
      reason: "extracted from truncated response",
    }))
    console.log(`[LLM] Regex salvage: ${events.length} events from truncated response`)
    return { events }
  }

  console.log(`[LLM] Could not salvage any events from truncated response`)
  return { events: [] }
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
