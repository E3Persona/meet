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

// Groq rate limiter
const GROQ_LIMITS = {
  requestsPerMinute: 30,
  requestsPerDay: 1000,
  tokensPerMinute: 12000,
  tokensPerDay: 100000,
}

class GroqRateLimiter {
  private requestTimestamps: number[] = []
  private dailyRequestCount = 0
  private dailyTokensUsed = 0
  private minuteTokensUsed = 0
  private lastMinuteReset = Date.now()
  private lastDayReset = Date.now()

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()

    // Reset counters
    if (now - this.lastDayReset > 24 * 60 * 60 * 1000) {
      this.dailyRequestCount = 0
      this.dailyTokensUsed = 0
      this.lastDayReset = now
    }
    if (now - this.lastMinuteReset > 60 * 1000) {
      this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60 * 1000)
      this.minuteTokensUsed = 0
      this.lastMinuteReset = now
    }

    // Check daily limits
    if (this.dailyRequestCount >= GROQ_LIMITS.requestsPerDay) {
      const waitMs = this.lastDayReset + 24 * 60 * 60 * 1000 - now
      console.log(`[Groq Rate Limiter] Daily request limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }
    if (this.dailyTokensUsed >= GROQ_LIMITS.tokensPerDay) {
      const waitMs = this.lastDayReset + 24 * 60 * 60 * 1000 - now
      console.log(`[Groq Rate Limiter] Daily token limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }

    // Check minute limits
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
    this.dailyRequestCount++
    this.minuteTokensUsed += tokensUsed
    this.dailyTokensUsed += tokensUsed
    console.log(`[Groq Rate Limiter] Request: ${this.dailyRequestCount}/${GROQ_LIMITS.requestsPerDay} today, ${this.minuteTokensUsed}/${GROQ_LIMITS.tokensPerMinute} tokens/min`)
  }
}

const groqRateLimiter = new GroqRateLimiter()

// OpenRouter rate limiter (free tier limits)
const OPENROUTER_LIMITS = {
  requestsPerMinute: 20,
  requestsPerDay: 50,
}

class OpenRouterRateLimiter {
  private requestTimestamps: number[] = []
  private dailyRequestCount = 0
  private lastDayReset = Date.now()

  async waitIfNeeded(): Promise<void> {
    const now = Date.now()

    // Reset counters
    if (now - this.lastDayReset > 24 * 60 * 60 * 1000) {
      this.dailyRequestCount = 0
      this.lastDayReset = now
    }
    this.requestTimestamps = this.requestTimestamps.filter(t => now - t < 60 * 1000)

    // Check daily limit
    if (this.dailyRequestCount >= OPENROUTER_LIMITS.requestsPerDay) {
      const waitMs = this.lastDayReset + 24 * 60 * 60 * 1000 - now
      console.log(`[OpenRouter Rate Limiter] Daily request limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }

    // Check minute limit
    if (this.requestTimestamps.length >= OPENROUTER_LIMITS.requestsPerMinute) {
      const oldestTimestamp = this.requestTimestamps[0]
      const waitMs = oldestTimestamp + 60 * 1000 - now
      console.log(`[OpenRouter Rate Limiter] Minute request limit reached, waiting ${waitMs}ms`)
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.waitIfNeeded()
    }
  }

  recordRequest(): void {
    const now = Date.now()
    this.requestTimestamps.push(now)
    this.dailyRequestCount++
    console.log(`[OpenRouter Rate Limiter] Request: ${this.dailyRequestCount}/${OPENROUTER_LIMITS.requestsPerDay} today`)
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

async function callLlm(prompt: string): Promise<LlmExtractionResult> {
  // Groq (primary)
  const apiKey = process.env.GROQ_API_KEY
  if (apiKey) {
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
          max_tokens: 600,
        }),
        signal: AbortSignal.timeout(120000),
      })
      if (res.ok) {
        const data = await res.json()
        const content = data.choices?.[0]?.message?.content
        const tokensUsed = data.usage?.total_tokens ?? 0
        groqRateLimiter.recordRequest(tokensUsed)
        if (content) {
          const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()
          const parsed = JSON.parse(cleaned)
          console.log(`[LLM] Groq returned ${parsed.events?.length ?? 0} events (${tokensUsed} tokens)`)
          return { events: parsed.events ?? [] }
        }
      }
      console.log(`[LLM] Groq ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
    } catch (err) {
      console.log(`[LLM] Groq error:`, err instanceof Error ? err.message : err)
    }
  }

  // Fallback: OpenRouter
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!openRouterKey) return { events: [] }

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
        max_tokens: 300,
      }),
    })

    // Handle rate limit responses with Retry-After
    if (await openRouterRateLimiter.handleRateLimit(res)) {
      // Retry the request after waiting
      return callLlm(prompt)
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      console.error(`[LLM] OpenRouter ${res.status}: ${text.slice(0, 200)}`)
      return { events: [] }
    }

    openRouterRateLimiter.recordRequest()
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return { events: [] }
    const cleaned = content.replace(/```(?:json)?\s*/g, "").trim()
    const parsed = JSON.parse(cleaned)
    console.log(`[LLM] OpenRouter returned ${parsed.events?.length ?? 0} events`)
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
