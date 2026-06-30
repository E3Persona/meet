import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { ProviderRegistry } from "@/lib/providers"
import { getUsageSummary, clearUsage } from "@/lib/providers/cost-tracker"
import { createTavilyProvider } from "@/lib/providers/search/tavily"
import { createBraveProvider } from "@/lib/providers/search/brave"
import { createDuckDuckGoProvider } from "@/lib/providers/search/duckduckgo"
import { createFirecrawlProvider } from "@/lib/providers/scrape/firecrawl"
import { createWebPeelProvider } from "@/lib/providers/scrape/webpeel"
import { createJinaProvider } from "@/lib/providers/scrape/jina"

// ─── NEVER touch these fields from automated code ─────────────────────────────
// AGENTS.md hard boundary: organizerName, organizerTitle, organizerEmail,
// organizerPhone are ONLY filled by humans via inline-edit UI.

// ─── Build the provider registry ─────────────────────────────────────────────

function buildRegistry(): ProviderRegistry {
  return new ProviderRegistry({
    search: [
      { provider: createTavilyProvider(), priority: 1, dailyLimit: 33, enabled: !!process.env.TAVILY_API_KEY },
      { provider: createBraveProvider(), priority: 2, dailyLimit: 66, enabled: !!process.env.BRAVE_SEARCH_API_KEY },
      { provider: createDuckDuckGoProvider(), priority: 3, dailyLimit: 999, enabled: true },
    ],
    scrape: [
      { provider: createFirecrawlProvider(), priority: 1, dailyLimit: 16, enabled: !!process.env.FIRECRAWL_API_KEY },
      { provider: createWebPeelProvider(), priority: 2, dailyLimit: 125, enabled: !!process.env.WEBPEEL_API_KEY },
      { provider: createJinaProvider(), priority: 3, dailyLimit: 33, enabled: true },
    ],
  })
}

// ─── LLM Extraction ───────────────────────────────────────────────────────────
// Extracts events AND contacts found on the page. Contacts are a bonus —
// the primary goal is event discovery, but if contact info is right there
// we grab it so we don't have to re-scrape later.

async function extractEventsWithLLM(
  pageContent: string,
  pageTitle: string,
  pageUrl: string,
  locationName: string,
  searchMonth: string,
  sourceNotes: string | null
): Promise<{
  events: {
    eventName: string
    eventDateStart: string | null
    eventDateEnd: string | null
    confidence: "high" | "medium" | "low"
    reason: string
    contacts: {
      name: string
      title: string | null
      email: string | null
      phone: string | null
      confidence: string
    }[]
  }[]
}> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return { events: [] }

  const maxContentLength = 8000
  const truncatedContent =
    pageContent.length > maxContentLength
      ? pageContent.slice(0, maxContentLength) + "\n\n[Content truncated...]"
      : pageContent

  const sourceInstructions = sourceNotes
    ? `\nSOURCE-SITE INSTRUCTIONS:\n${sourceNotes}\n`
    : ""

  const prompt = `You are an expert event data extractor specializing in Meetings, Conventions, Tradeshows, Conferences, and Expos.

CONTEXT:
- We are searching for events at: ${locationName}
- The search was for month: ${searchMonth}
- Page title: ${pageTitle}
- Page URL: ${pageUrl}
${sourceInstructions}
PAGE CONTENT:
${truncatedContent}

TASK:
Extract ALL events/conferences/tradeshows mentioned on this page AND any contact persons associated with them.

FOR EACH EVENT, provide:
1. eventName: The full, accurate name of the event
2. eventDateStart: Start date in ISO format (YYYY-MM-DD) if found, null if not
3. eventDateEnd: End date in ISO format (YYYY-MM-DD) if found, null if not
4. confidence: "high" if clearly stated, "medium" if partially clear, "low" if inferred
5. reason: Brief note on where/how you found this event
6. contacts: Array of contact persons found for THIS specific event on this page

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
- You may find 0-5 contacts per event

EVENT RULES:
- Extract events AT or NEAR the venue "${locationName}" in ${searchMonth}
- Be precise with event names — include year, full title
- Only extract meetings, conventions, tradeshows, conferences, expos, summits, forums, shows
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
      "reason": "...",
      "contacts": [
        {
          "name": "First Last",
          "title": "Title" or null,
          "email": "email@domain.com" or null,
          "phone": "123-456-7891" or null,
          "confidence": "high" | "medium" | "low"
        }
      ]
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

// ─── Dedupe check ─────────────────────────────────────────────────────────────

async function isDuplicate(eventName: string, locationId: string, eventDateStart: Date | null): Promise<boolean> {
  const existing = await prisma.event.findFirst({
    where: {
      eventName: { equals: eventName, mode: "insensitive" },
      locationId,
      eventDateStart: eventDateStart ?? undefined,
    },
  })
  return !!existing
}

// ─── Template expansion ───────────────────────────────────────────────────────

function expandTemplate(template: string, location: { city: string | null; name: string }): string {
  const now = new Date()
  return template
    .replace(/\{CITY\}/g, location.city ?? "")
    .replace(/\{VENUE\}/g, location.name)
    .replace(/\{MONTH\}/g, now.toLocaleString("en-US", { month: "long" }))
    .replace(/\{YEAR\}/g, String(now.getFullYear()))
}

// ─── Query builders ───────────────────────────────────────────────────────────

function buildTemplateQueries(
  templates: { id: string; template: string }[],
  locations: { id: string; name: string; city: string | null }[]
) {
  const queries: { locationId: string; locationName: string; query: string; monthLabel: string }[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthLabel = `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`
    for (const template of templates) {
      if (/\{(CITY|VENUE|MONTH|YEAR)\}/.test(template.template)) {
        for (const loc of locations) {
          queries.push({ locationId: loc.id, locationName: loc.name, query: expandTemplate(template.template, loc), monthLabel })
        }
      } else {
        queries.push({ locationId: locations[0].id, locationName: locations[0].name, query: template.template, monthLabel })
      }
    }
  }
  return queries
}

function buildSearchTermQueries(
  locations: { id: string; name: string; searchTerms: { id: string; keyword: string }[] }[]
) {
  const queries: { locationId: string; locationName: string; query: string; monthLabel: string }[] = []
  const now = new Date()
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthLabel = `${d.toLocaleString("en-US", { month: "long" })} ${d.getFullYear()}`
    for (const loc of locations) {
      for (const term of loc.searchTerms) {
        queries.push({ locationId: loc.id, locationName: loc.name, query: `${monthLabel} ${term.keyword} ${loc.name}`, monthLabel })
      }
    }
  }
  return queries
}

// ─── URL pattern matching ─────────────────────────────────────────────────────

function compileUrlPatterns(patterns: string[]): RegExp[] {
  return patterns
    .filter(Boolean)
    .map((p) => { try { return new RegExp(p, "i") } catch { return null } })
    .filter(Boolean) as RegExp[]
}

function isKnownSource(url: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(url))
}

// ─── Process a URL through providers ──────────────────────────────────────────

async function processUrl(
  url: string,
  title: string,
  locationId: string,
  locationName: string,
  monthLabel: string,
  runId: string,
  sourceSiteId: string | null,
  sourceNotes: string | null,
  registry: ProviderRegistry,
  counters: { totalFound: number; totalNew: number }
) {
  counters.totalFound++

  const { result } = await registry.scrape(url, { runId })
  if (!result.markdown || result.markdown.length < 200) return

  const { events: extracted } = await extractEventsWithLLM(
    result.markdown, title, url, locationName, monthLabel, sourceNotes
  )

  for (const ext of extracted) {
    if (ext.confidence === "low") continue

    let eventDateStart: Date | null = null
    let eventDateEnd: Date | null = null
    if (ext.eventDateStart) { const d = new Date(ext.eventDateStart); if (!isNaN(d.getTime())) eventDateStart = d }
    if (ext.eventDateEnd) { const d = new Date(ext.eventDateEnd); if (!isNaN(d.getTime())) eventDateEnd = d }

    const eventName = ext.eventName.trim()
    if (eventName.length < 3) continue
    if (await isDuplicate(eventName, locationId, eventDateStart)) continue

    const event = await prisma.event.create({
      data: { locationId, eventName, eventDateStart, eventDateEnd, sourceUrl: url, sourceSiteId, runId },
    })
    counters.totalNew++

    // Save contacts found during ingestion — don't wait for separate find-contact step
    if (ext.contacts && ext.contacts.length > 0) {
      let firstSaved = false
      for (const c of ext.contacts) {
        if (!c.name || c.name.length < 2) continue
        await prisma.eventContact.create({
          data: {
            eventId: event.id,
            name: c.name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            isPrimary: !firstSaved,
            sourceUrl: url,
            confidence: c.confidence ?? "medium",
          },
        })
        // Sync legacy fields from first/primary contact
        if (!firstSaved) {
          await prisma.event.update({
            where: { id: event.id },
            data: {
              organizerName: c.name,
              organizerTitle: c.title,
              organizerEmail: c.email,
              organizerPhone: c.phone,
            },
          })
          firstSaved = true
        }
      }
      console.log(`[Ingest] Saved ${ext.contacts.length} contact(s) for "${eventName}"`)
    }
  }
}

// ─── Sleep ────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ─── POST /api/ingest/run ─────────────────────────────────────────────────────

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url)
  const trigger = searchParams.get("trigger") === "scheduled" ? "scheduled" : "manual"

  // Accept optional body for schedule-specific runs
  let body: { locationIds?: string[]; templateIds?: string[]; sourceSiteIds?: string[] } = {}
  try { body = await request.json() } catch { /* no body */ }

  console.log(`\n[Ingest] Starting ${trigger} run at ${new Date().toISOString()}`)

  const run = await prisma.ingestionRun.create({ data: { trigger, status: "running" } })
  clearUsage(run.id)

  try {
    const registry = buildRegistry()

    // Load data — optionally filtered by schedule
    const [locations, templates, sourceSites] = await Promise.all([
      prisma.location.findMany({
        where: { active: true, ...(body.locationIds?.length ? { id: { in: body.locationIds } } : {}) },
        include: { searchTerms: { where: { active: true } } },
      }),
      prisma.searchTemplate.findMany({
        where: { active: true, ...(body.templateIds?.length ? { id: { in: body.templateIds } } : {}) },
      }),
      prisma.sourceSite.findMany({
        where: { active: true, ...(body.sourceSiteIds?.length ? { id: { in: body.sourceSiteIds } } : {}) },
      }),
    ])

    if (locations.length === 0) {
      await prisma.ingestionRun.update({
        where: { id: run.id },
        data: { status: "success", finishedAt: new Date(), recordsFound: 0, recordsNew: 0, errorMessage: "No active locations" },
      })
      return NextResponse.json({ runId: run.id, recordsFound: 0, recordsNew: 0 })
    }

    const counters = { totalFound: 0, totalNew: 0 }
    const knownPatterns = compileUrlPatterns(sourceSites.filter((s) => s.urlPattern && s.scrapeMode !== "skip").map((s) => s.urlPattern!))

    // ── Phase 1: Known SourceSites ──────────────────────────────────────
    const scrapable = sourceSites.filter((s) => s.scrapeMode !== "skip" && s.url)
    console.log(`\n[Phase 1] SourceSite crawl: ${scrapable.length} sites`)
    const monthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" })

    for (const site of scrapable) {
      let eventsBefore = counters.totalNew
      try {
        if (site.scrapeMode === "search") {
          for (const loc of locations) {
            const slug = (loc.city ?? "").toLowerCase().replace(/\s+/g, "-")
            let searchUrl = site.url!
            if (site.urlPattern?.includes("10times")) searchUrl = `https://10times.com/${slug}/upcoming`
            else if (site.urlPattern?.includes("eventbrite")) searchUrl = `https://www.eventbrite.com/d/${slug}/meetings/`
            else if (site.urlPattern?.includes("allconferencealert")) searchUrl = `https://allconferencealert.net/usa.php?city=${slug}`
            else searchUrl = `${site.url}/${slug}`
            await sleep(500)
            await processUrl(searchUrl, `${site.name} - ${loc.name}`, loc.id, loc.name, monthLabel, run.id, site.id, site.notes, registry, counters)
          }
        } else {
          await sleep(500)
          const { result } = await registry.scrape(site.url!, { runId: run.id })
          if (result.markdown && result.markdown.length > 200) {
            for (const loc of locations) {
              const cityLower = (loc.city ?? "").toLowerCase()
              const nameLower = loc.name.toLowerCase()
              if ((cityLower && result.markdown.toLowerCase().includes(cityLower)) || result.markdown.toLowerCase().includes(nameLower)) {
                await processUrl(site.url!, site.name, loc.id, loc.name, monthLabel, run.id, site.id, site.notes, registry, counters)
              }
            }
          }
        }
      } catch (err) { console.error(`[Phase 1] ${site.name} error:`, err) }

      const eventsThisRun = counters.totalNew - eventsBefore
      await prisma.sourceSite.update({
        where: { id: site.id },
        data: { lastScrapedAt: new Date(), lastScrapeStatus: counters.totalNew > eventsBefore ? "success" : "partial", eventsFound: { increment: eventsThisRun } },
      }).catch(() => {})
    }

    // ── Phase 2: Template-expanded search ───────────────────────────────
    if (templates.length > 0) {
      const templateQueries = buildTemplateQueries(templates, locations)
      console.log(`\n[Phase 2] Template search: ${templateQueries.length} queries`)
      for (let i = 0; i < templateQueries.length; i++) {
        const q = templateQueries[i]
        const { results } = await registry.search(q.query, { runId: run.id })
        for (const r of results) {
          if (isKnownSource(r.url, knownPatterns)) continue
          await sleep(500)
          await processUrl(r.url, r.title, q.locationId, q.locationName, q.monthLabel, run.id, null, null, registry, counters)
        }
        if ((i + 1) % 10 === 0) console.log(`[Phase 2] ${i + 1}/${templateQueries.length}, ${counters.totalNew} new`)
      }
    }

    // ── Phase 3: Legacy SearchTerms ─────────────────────────────────────
    const locsWTerms = locations.filter((l) => l.searchTerms.length > 0)
    if (locsWTerms.length > 0) {
      const termQueries = buildSearchTermQueries(locsWTerms)
      console.log(`\n[Phase 3] Legacy search: ${termQueries.length} queries`)
      for (let i = 0; i < termQueries.length; i++) {
        const q = termQueries[i]
        const { results } = await registry.search(q.query, { runId: run.id })
        for (const r of results) {
          if (isKnownSource(r.url, knownPatterns)) continue
          await sleep(500)
          await processUrl(r.url, r.title, q.locationId, q.locationName, q.monthLabel, run.id, null, null, registry, counters)
        }
        if ((i + 1) % 10 === 0) console.log(`[Phase 3] ${i + 1}/${termQueries.length}, ${counters.totalNew} new`)
      }
    }

    // ── Finalize ────────────────────────────────────────────────────────
    const providersUsed = getUsageSummary(run.id)
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "success", finishedAt: new Date(), recordsFound: counters.totalFound, recordsNew: counters.totalNew, providersUsed },
    })

    console.log(`\n[Ingest] Complete: ${counters.totalNew} new from ${counters.totalFound} scanned`)
    console.log(`[Ingest] Providers used:`, providersUsed)

    return NextResponse.json({ runId: run.id, recordsFound: counters.totalFound, recordsNew: counters.totalNew, providersUsed })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown"
    console.error(`[Ingest] Fatal:`, error)
    await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), errorMessage } })
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
