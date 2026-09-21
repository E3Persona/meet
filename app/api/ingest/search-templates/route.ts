import { NextResponse } from "next/server"
import { startScraperRun } from "@/lib/run-scraper"

import { prisma } from "@/lib/prisma"
import { runSearchTemplates } from "@/lib/scrapers/ingest-search-templates"

interface SearchTemplatesRequestBody {
  // Targeted mode: provide these to search specific templates/terms against
  // specific cities/venues right now, regardless of staleness. Runs inline
  // and the response includes real result counts.
  searchTemplateIds?: string[]
  searchTermIds?: string[]
  locationIds?: string[]

  // Config overrides (persisted to IngestConfig for future round-robin runs)
  monthsAhead?: number
  batchSize?: number
  batchDelayMs?: number
  active?: boolean

  // Round-robin mode only — passed through to the GitHub Actions workflow
  dateFrom?: string
  dateTo?: string
}

// Targeted runs execute inline in the request, so cap how much a single
// call can do to stay well inside API route timeout limits. Bigger sweeps
// belong in round-robin mode via GitHub Actions instead.
const MAX_TARGETED_BATCH_SIZE = 25

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as SearchTemplatesRequestBody
  const {
    searchTemplateIds,
    searchTermIds,
    locationIds,
    monthsAhead,
    batchSize,
    batchDelayMs,
    active,
    dateFrom,
    dateTo,
  } = body

  if (active === false) {
    return NextResponse.json(
      { error: "Search templates ingestion is disabled via config" },
      { status: 409 }
    )
  }

  const isTargeted = Boolean(searchTemplateIds?.length || searchTermIds?.length)

  // locationIds without any template/term ids doesn't mean anything on its
  // own — fail clearly instead of silently falling through to round-robin.
  if (locationIds?.length && !isTargeted) {
    return NextResponse.json(
      {
        error:
          "locationIds requires at least one of searchTemplateIds or searchTermIds",
      },
      { status: 400 }
    )
  }

  // Persist config overrides regardless of mode — round-robin reads these
  // from IngestConfig on its next scheduled run either way.
  if (
    monthsAhead !== undefined ||
    batchSize !== undefined ||
    batchDelayMs !== undefined
  ) {
    await prisma.ingestConfig.upsert({
      where: { scraper: "search-templates" },
      update: {
        ...(monthsAhead !== undefined && { maxMonths: monthsAhead }),
        ...(batchSize !== undefined && { maxPages: batchSize }),
        ...(batchDelayMs !== undefined && { batchDelayMs }),
      },
      create: {
        scraper: "search-templates",
        maxMonths: monthsAhead ?? 3,
        maxPages: batchSize ?? 10,
        batchDelayMs: batchDelayMs ?? 3000,
        active: true,
      },
    })
  }

  /* ── Targeted mode: run inline, return real counts ── */
  if (isTargeted) {
    const cappedBatchSize = Math.min(batchSize ?? 10, MAX_TARGETED_BATCH_SIZE)

    const summary = await runSearchTemplates({
      searchTemplateIds,
      searchTermIds,
      locationIds,
      monthsAhead,
      batchSize: cappedBatchSize,
      batchDelayMs,
    })

    return NextResponse.json({
      mode: "targeted",
      status: "completed",
      searchTemplateIds: searchTemplateIds ?? [],
      searchTermIds: searchTermIds ?? [],
      locationIds: locationIds ?? [],
      ...summary,
    })
  }

  /* ── Round-robin mode: hand off to GitHub Actions, unattended ── */
  const { runId } = await startScraperRun(
    "ingest-search-templates.ts",
    "search-templates",
    "manual",
    false,
    dateFrom,
    dateTo
  )

  return NextResponse.json({
    mode: "round-robin",
    runId,
    status: "running",
  })
}
