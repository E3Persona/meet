import "dotenv/config"
import { prisma } from "@/lib/prisma"
// import { searchGoogle } from "@/lib/search-provider"
import { enrichEvent } from "@/lib/search/enrich-event"
// import type { EventMatchType, LocationType } from "@/lib/search/generated/prisma"
import { searchGoogle } from "../search/search-provider"
import { EventMatchType, LocationType } from "../generated/prisma/enums"
import { startIngestRun, finishIngestRun } from "../ingest-run"

export interface RunSearchTemplatesOptions {
  // Targeted mode: only these templates/terms, only these locations.
  // Omit both for round-robin mode (everything due, ranked by staleness).
  searchTemplateIds?: string[]
  searchTermIds?: string[]
  locationIds?: string[]

  monthsAhead?: number // how many months forward to generate {MONTH}/{YEAR} combos for
  batchSize?: number // max tuples to actually search this run
  batchDelayMs?: number // delay between search calls to stay polite
  runId?: string | null
  sourceSiteId?: string | null
}

interface CandidateTuple {
  kind: "template" | "term"
  templateId: string | null
  termId: string | null
  resolvedQuery: string
  locationId: string | null
  locationType: LocationType | null
  targetMonth: number
  targetYear: number
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]

function monthWindow(
  monthsAhead: number,
  now = new Date()
): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = []
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    out.push({ month: d.getMonth() + 1, year: d.getFullYear() })
  }
  return out
}

function resolveTemplateString(
  template: string,
  vars: { city?: string; venue?: string; month?: string; year?: string }
): string {
  return template
    .replace(/\{CITY\}/g, vars.city ?? "")
    .replace(/\{VENUE\}/g, vars.venue ?? "")
    .replace(/\{MONTH\}/g, vars.month ?? "")
    .replace(/\{YEAR\}/g, vars.year ?? "")
    .replace(/\s+/g, " ")
    .trim()
}

/* ──────────────────────────────────────────────────────────
   Expansion: build every candidate (template/term × location ×
   month) tuple that's currently eligible to run.
   ────────────────────────────────────────────────────────── */
async function buildCandidates(
  opts: RunSearchTemplatesOptions
): Promise<CandidateTuple[]> {
  const monthsAhead = opts.monthsAhead ?? 3
  const months = monthWindow(monthsAhead)
  const candidates: CandidateTuple[] = []

  const explicitLocationFilter = opts.locationIds?.length
    ? { id: { in: opts.locationIds } }
    : {}

  /* ── Templates ── */
  const templateWhere: Record<string, unknown> = { active: true }
  if (opts.searchTemplateIds?.length)
    templateWhere.id = { in: opts.searchTemplateIds }

  const templates = await prisma.searchTemplate.findMany({
    where: templateWhere,
  })

  for (const template of templates) {
    if (template.scope === "GLOBAL") {
      for (const { month, year } of months) {
        const resolvedQuery = resolveTemplateString(template.template, {
          month: MONTH_NAMES[month - 1],
          year: String(year),
        })
        candidates.push({
          kind: "template",
          templateId: template.id,
          termId: null,
          resolvedQuery,
          locationId: null,
          locationType: null,
          targetMonth: month,
          targetYear: year,
        })
      }
      continue
    }

    const locationType: LocationType =
      template.scope === "VENUE" ? "VENUE" : "CITY"
    const locations = await prisma.location.findMany({
      where: { type: locationType, active: true, ...explicitLocationFilter },
    })

    for (const location of locations) {
      for (const { month, year } of months) {
        const resolvedQuery = resolveTemplateString(template.template, {
          city:
            locationType === "CITY"
              ? location.name
              : (location.city ?? undefined),
          venue: locationType === "VENUE" ? location.name : undefined,
          month: MONTH_NAMES[month - 1],
          year: String(year),
        })
        candidates.push({
          kind: "template",
          templateId: template.id,
          termId: null,
          resolvedQuery,
          locationId: location.id,
          locationType,
          targetMonth: month,
          targetYear: year,
        })
      }
    }
  }

  /* ── Literal search terms ── */
  // Only expanded when explicitly requested via searchTermIds, OR in
  // round-robin mode (no template/term filter given at all) — this keeps a
  // *targeted* template+location run from also pulling in unrelated terms.
  const includeTerms =
    opts.searchTermIds?.length ||
    (!opts.searchTemplateIds?.length && !opts.searchTermIds)

  if (includeTerms) {
    const termWhere: Record<string, unknown> = { active: true }
    if (opts.searchTermIds?.length) termWhere.id = { in: opts.searchTermIds }

    const terms = await prisma.searchTerm.findMany({
      where: termWhere,
      include: { location: true },
    })

    for (const term of terms) {
      if (
        term.locationId &&
        opts.locationIds?.length &&
        !opts.locationIds.includes(term.locationId)
      ) {
        continue // explicit location filter excludes this term's pinned location
      }

      for (const { month, year } of months) {
        candidates.push({
          kind: "term",
          templateId: null,
          termId: term.id,
          resolvedQuery: term.keyword,
          locationId: term.locationId,
          locationType: term.location?.type ?? null,
          targetMonth: month,
          targetYear: year,
        })
      }
    }
  }

  return candidates
}

/* ──────────────────────────────────────────────────────────
   Ranking: never-run tuples first, then oldest lastRunAt.
   Targeted mode (explicit templates+locations) skips the
   staleness filter — a manual "search these now" request
   runs unconditionally rather than being told "not due yet".
   ────────────────────────────────────────────────────────── */
async function rankByDue(
  candidates: CandidateTuple[],
  isTargeted: boolean
): Promise<CandidateTuple[]> {
  if (candidates.length === 0) return []

  const executions = await prisma.searchExecution.findMany({
    where: {
      OR: candidates.map((c) => ({
        searchTemplateId: c.templateId,
        searchTermId: c.termId,
        locationId: c.locationId,
        targetMonth: c.targetMonth,
        targetYear: c.targetYear,
      })),
    },
  })

  const lastRunMap = new Map<string, Date>()
  for (const exec of executions) {
    const key = `${exec.searchTemplateId ?? ""}|${exec.searchTermId ?? ""}|${exec.locationId ?? ""}|${exec.targetMonth}|${exec.targetYear}`
    lastRunMap.set(key, exec.lastRunAt)
  }

  const withRecency = candidates.map((c) => {
    const key = `${c.templateId ?? ""}|${c.termId ?? ""}|${c.locationId ?? ""}|${c.targetMonth}|${c.targetYear}`
    return { candidate: c, lastRunAt: lastRunMap.get(key) ?? null }
  })

  if (isTargeted) {
    // Run everything requested, oldest-searched first (still useful ordering,
    // just not a filter).
    return withRecency
      .sort(
        (a, b) => (a.lastRunAt?.getTime() ?? 0) - (b.lastRunAt?.getTime() ?? 0)
      )
      .map((w) => w.candidate)
  }

  // Round-robin: never-run first, then oldest lastRunAt.
  return withRecency
    .sort((a, b) => {
      if (!a.lastRunAt && !b.lastRunAt) return 0
      if (!a.lastRunAt) return -1
      if (!b.lastRunAt) return 1
      return a.lastRunAt.getTime() - b.lastRunAt.getTime()
    })
    .map((w) => w.candidate)
}

function matchTypeForLocationType(
  locationType: LocationType | null
): EventMatchType {
  if (locationType === "VENUE") return "venue_matched"
  if (locationType === "CITY") return "location_matched"
  return "unmatched"
}

/* ──────────────────────────────────────────────────────────
   Main entry point
   ────────────────────────────────────────────────────────── */
export async function runSearchTemplates(
  opts: RunSearchTemplatesOptions = {}
): Promise<{
  searched: number
  resultsSaved: number
  eventsEnriched: number
  providerBreakdown: { google_scrape: number; serper_fallback: number }
}> {
  const batchSize = opts.batchSize ?? 10
  const batchDelayMs = opts.batchDelayMs ?? 3000
  const isTargeted = Boolean(
    opts.searchTemplateIds?.length || opts.searchTermIds?.length
  )

  const allCandidates = await buildCandidates(opts)
  if (allCandidates.length === 0) {
    console.warn("[SearchTemplates] No candidates matched the given filters.")
    return {
      searched: 0,
      resultsSaved: 0,
      eventsEnriched: 0,
      providerBreakdown: { google_scrape: 0, serper_fallback: 0 },
    }
  }

  const ranked = await rankByDue(allCandidates, isTargeted)
  const batch = ranked.slice(0, batchSize)

  console.log(
    `[SearchTemplates] ${allCandidates.length} candidates, running batch of ${batch.length} (targeted=${isTargeted})`
  )

  let resultsSaved = 0
  let eventsEnriched = 0
  const providerBreakdown = { google_scrape: 0, serper_fallback: 0 }

  for (const tuple of batch) {
    console.log(
      `[SearchTemplates] Searching: "${tuple.resolvedQuery}" (${tuple.targetMonth}/${tuple.targetYear})`
    )

    let results: Awaited<ReturnType<typeof searchGoogle>>["results"] = []
    try {
      const outcome = await searchGoogle({
        query: tuple.resolvedQuery,
        monthsAhead: 1,
      })
      results = outcome.results
      providerBreakdown[outcome.provider]++
      console.log(
        `[SearchTemplates] "${tuple.resolvedQuery}" → ${results.length} results via ${outcome.provider}`
      )
    } catch (err) {
      console.error(
        `[SearchTemplates] Search failed entirely for "${tuple.resolvedQuery}":`,
        err
      )
      results = []
    }

    const webSearchQuery = await prisma.webSearchQuery.create({
      data: { query: tuple.resolvedQuery },
    })

    let enrichedForTuple = 0

    for (const result of results) {
      await prisma.webSearchResult.create({
        data: {
          queryId: webSearchQuery.id,
          source: "google",
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          publishedDate: result.eventDate ? new Date(result.eventDate) : null,
          page: result.page,
        },
      })
      resultsSaved++

      // Enrichment only makes sense when we have a Location to attach the
      // Event to (venue/city). GLOBAL-scope tuples have no location — skip.
      if (tuple.locationId) {
        const enriched = await enrichEvent({
          url: result.url,
          locationId: tuple.locationId,
          matchType: matchTypeForLocationType(tuple.locationType),
          runId: opts.runId ?? null,
          sourceSiteId: opts.sourceSiteId ?? null,
          fallbackEventDate: result.eventDate,
        })
        if (enriched) {
          eventsEnriched++
          enrichedForTuple++
        }
      }
    }

    const existing = await prisma.searchExecution.findFirst({
      where: {
        searchTemplateId: tuple.templateId ?? undefined,
        searchTermId: tuple.termId ?? undefined,
        locationId: tuple.locationId ?? undefined,
        targetMonth: tuple.targetMonth,
        targetYear: tuple.targetYear,
      },
    })

    if (existing) {
      await prisma.searchExecution.update({
        where: { id: existing.id },
        data: {
          resolvedQuery: tuple.resolvedQuery,
          lastRunAt: new Date(),
          resultCount: results.length,
          webSearchQueryId: webSearchQuery.id,
        },
      })
    } else {
      await prisma.searchExecution.create({
        data: {
          searchTemplateId: tuple.templateId,
          searchTermId: tuple.termId,
          locationId: tuple.locationId,
          targetMonth: tuple.targetMonth,
          targetYear: tuple.targetYear,
          resolvedQuery: tuple.resolvedQuery,
          resultCount: results.length,
          webSearchQueryId: webSearchQuery.id,
        },
      })
    }

    await new Promise((r) => setTimeout(r, batchDelayMs))
  }

  console.log(
    `[SearchTemplates] Done. Searched=${batch.length} ResultsSaved=${resultsSaved} EventsEnriched=${eventsEnriched} ` +
      `Providers(google_scrape=${providerBreakdown.google_scrape}, serper_fallback=${providerBreakdown.serper_fallback})`
  )

  return {
    searched: batch.length,
    resultsSaved,
    eventsEnriched,
    providerBreakdown,
  }
}

/* ──────────────────────────────────────────────────────────
    CLI entry point
    ────────────────────────────────────────────────────────── */
if (require.main === module) {
  const args = process.argv.slice(2)
  const runIdArg = args[0] // optional runId passed from the workflow trigger

  const ctx = await startIngestRun(
    (process.env.TRIGGER as "manual" | "scheduled") ?? "manual"
  )

  try {
    const summary = await runSearchTemplates({
      runId: runIdArg || ctx.runId,
    })
    console.log("[SearchTemplates] Summary:", summary)
    await finishIngestRun(ctx, {
      recordsFound: summary.searched,
      recordsNew: summary.eventsEnriched,
    })
    process.exit(0)
  } catch (err) {
    console.error("[SearchTemplates] Fatal error:", err)
    await finishIngestRun(ctx, {
      recordsFound: 0,
      recordsNew: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    process.exit(1)
  }
}
