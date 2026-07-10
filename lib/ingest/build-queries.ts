import { prisma } from "@/lib/prisma"
import type { SearchQuery } from "./search-pipeline"

export async function buildSearchQueries(
  opts: {
    locationIds?: string[]
    dateFrom?: string
    dateTo?: string
    maxQueries?: number
    skipGlobalTerms?: boolean
  } = {}
): Promise<SearchQuery[]> {
  const queries: SearchQuery[] = []

  // ── Load templates with scope ──────────────────────────────────────────
  const templates = await prisma.searchTemplate.findMany({ where: { active: true } })

  // ── Load search terms (global + location-pinned) ───────────────────────
  const globalTerms = await prisma.searchTerm.findMany({
    where: { active: true, locationId: null },
  })
  const pinnedTerms = await prisma.searchTerm.findMany({
    where: { active: true, locationId: { not: null } },
  })
  const pinnedByLocation = new Map<string, typeof pinnedTerms>()
  for (const term of pinnedTerms) {
    const locId = term.locationId!
    if (!pinnedByLocation.has(locId)) pinnedByLocation.set(locId, [])
    pinnedByLocation.get(locId)!.push(term)
  }

  // ── Resolve scope targets ─────────────────────────────────────────────
  const cityLocations = await prisma.location.findMany({
    where: {
      active: true,
      type: "CITY",
      ...(opts.locationIds?.length ? { id: { in: opts.locationIds } } : {}),
    },
  })
  const venueLocations = await prisma.location.findMany({
    where: {
      active: true,
      type: "VENUE",
      ...(opts.locationIds?.length ? { id: { in: opts.locationIds } } : {}),
    },
  })

  // If specific locationIds given but none are CITY, we still need cities
  // that own the requested venues for CITY-scoped templates
  let allCities = cityLocations
  if (opts.locationIds?.length && venueLocations.length > 0) {
    const parentIds = [...new Set(venueLocations.map((v) => v.parentId).filter(Boolean))]
    const missingCityIds = parentIds.filter((pid) => !allCities.some((c) => c.id === pid))
    if (missingCityIds.length > 0) {
      const missingCities = await prisma.location.findMany({
        where: { id: { in: missingCityIds as string[] }, active: true },
      })
      allCities = [...allCities, ...missingCities]
    }
  }

  // ── Determine month range ──────────────────────────────────────────────
  const now = new Date()
  let startMonth = 0
  let endMonth = 5 // default: 6 months from now

  if (opts.dateFrom) {
    const d = new Date(opts.dateFrom)
    if (!isNaN(d.getTime())) {
      startMonth = Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth())
    }
  }
  if (opts.dateTo) {
    const d = new Date(opts.dateTo)
    if (!isNaN(d.getTime())) {
      endMonth = (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth()
    }
  }

  for (let i = startMonth; i <= endMonth; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const monthName = d.toLocaleString("en-US", { month: "long" })
    const yearName = String(d.getFullYear())
    const monthLabel = `${monthName} ${yearName}`
    const monthLower = monthName.toLowerCase()

    for (const tmpl of templates) {
      if (tmpl.scope === "CITY") {
        for (const city of allCities) {
          const expanded = tmpl.template
            .replace(/\{CITY\}/g, city.city ?? city.name)
            .replace(/\{MONTH\}/g, monthName)
            .replace(/\{YEAR\}/g, yearName)
          queries.push({
            locationId: city.id,
            locationName: city.name,
            monthLabel,
            query: expanded,
          })
        }
      } else if (tmpl.scope === "VENUE") {
        for (const venue of venueLocations) {
          const expanded = tmpl.template
            .replace(/\{VENUE\}/g, venue.name)
            .replace(/\{MONTH\}/g, monthName)
            .replace(/\{YEAR\}/g, yearName)
          queries.push({
            locationId: venue.id,
            locationName: venue.name,
            monthLabel,
            query: expanded,
          })
        }
      } else {
        queries.push({
          locationId: null,
          locationName: "global",
          monthLabel,
          query: tmpl.template,
        })
      }
    }

    // ── Global search terms (run per city) ──────────────────────────────────
    if (!opts.skipGlobalTerms) {
      for (const term of globalTerms) {
        for (const city of allCities) {
          queries.push({
            locationId: city.id,
            locationName: city.name,
            monthLabel,
            query: `${monthLabel} ${term.keyword} ${city.city ?? city.name}`,
          })
        }
      }

      // ── Pinned search terms (run only for that location) ─────────────────
      for (const venue of venueLocations) {
        const terms = pinnedByLocation.get(venue.id) ?? []
        for (const term of terms) {
          queries.push({
            locationId: venue.id,
            locationName: venue.name,
            monthLabel,
            query: `${monthLabel} ${term.keyword} ${venue.city ?? venue.name}`,
          })
        }
      }
    }
  }

  if (opts.maxQueries && queries.length > opts.maxQueries) {
    return queries.slice(0, opts.maxQueries)
  }

  return queries
}
