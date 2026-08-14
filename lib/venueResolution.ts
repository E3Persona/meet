import { PrismaClient, Location, EventMatchType } from "@/lib/generated/prisma/client"
import { normalizeState, statesMatch } from "@/lib/stateNormalize"

export interface ResolvedVenue {
  locationId: string | null
  venueId: string | null
  matchType: EventMatchType
  rawVenueText: string | null
  rawLocationText: string | null
}

export async function resolveVenue({
  rawVenueText,
  rawCityText,
  rawStateText,
  venueIdFromSource,
  directoryType,
  prisma,
}: {
  rawVenueText: string | null
  rawCityText: string | null
  rawStateText: string | null
  venueIdFromSource: string | null
  directoryType: string
  prisma: PrismaClient
}): Promise<ResolvedVenue> {
  if (venueIdFromSource && directoryType !== "city_aggregator") {
    const venue = await prisma.location.findUnique({
      where: { id: venueIdFromSource },
      select: { id: true, city: true, state: true, parentId: true, venueType: true },
    })
    if (venue) {
      const cityLoc = venue.parentId
        ? await prisma.location.findUnique({ where: { id: venue.parentId }, select: { id: true } })
        : await prisma.location.findFirst({
            where: {
              type: "CITY",
              name: { equals: venue.city ?? "", mode: "insensitive" },
              ...(venue.state ? { OR: [
                { state: venue.state },
                { state: normalizeState(venue.state) },
              ] } : {}),
            },
            select: { id: true },
          })
      const useCityId = venue.venueType === "ConventionCenter" || venue.venueType === "Arena" || venue.venueType === "Fairgrounds"
      return {
        locationId: cityLoc?.id ?? (useCityId ? null : venue.id),
        venueId: venue.id,
        matchType: "venue_matched_from_source",
        rawVenueText,
        rawLocationText: null,
      }
    }
  }

  if (rawVenueText) {
    const fuzzyVenue = await findFuzzyVenueMatch(rawVenueText, rawCityText, prisma)
    if (fuzzyVenue) return fuzzyVenue
  }

  if (rawCityText || rawStateText) {
    const cityLoc = await findCityLocation(rawCityText, rawStateText, prisma)
    if (cityLoc) {
      return {
        locationId: cityLoc.id,
        venueId: null,
        matchType: "location_matched",
        rawVenueText,
        rawLocationText: [rawCityText, rawStateText].filter(Boolean).join(", "),
      }
    }
  }

  return {
    locationId: "",
    venueId: null,
    matchType: "unmatched",
    rawVenueText,
    rawLocationText: [rawCityText, rawStateText].filter(Boolean).join(", "),
  }
}

async function findFuzzyVenueMatch(
  venueText: string,
  cityHint: string | null,
  prisma: PrismaClient
): Promise<ResolvedVenue | null> {
  const cleanName = normalizeVenueName(venueText)
  const allVenues = await prisma.location.findMany({
    where: { type: "VENUE", active: true },
    select: { id: true, name: true, city: true, state: true, parentId: true },
  })

  let best: { venue: typeof allVenues[number]; score: number } | null = null

  for (const venue of allVenues) {
    const score = similarity(cleanName, normalizeVenueName(venue.name))
    if (score >= 0.75 && (!best || score > best.score)) {
      if (cityHint && venue.city && normalizeVenueName(venue.city).includes(normalizeVenueName(cityHint))) {
        best = { venue, score }
      } else if (!cityHint) {
        best = { venue, score }
      }
    }
  }

  if (!best) return null

  const cityLoc = best.venue.parentId
    ? await prisma.location.findUnique({ where: { id: best.venue.parentId }, select: { id: true } })
    : await prisma.location.findFirst({
        where: {
          type: "CITY",
          name: { equals: best.venue.city ?? "", mode: "insensitive" },
          ...(best.venue.state ? { OR: [
            { state: best.venue.state },
            { state: normalizeState(best.venue.state) },
          ] } : {}),
        },
        select: { id: true },
      })

  return {
    locationId: cityLoc?.id ?? best.venue.id,
    venueId: best.venue.id,
    matchType: "venue_matched",
    rawVenueText: venueText,
    rawLocationText: null,
  }
}

async function findCityLocation(
  city: string | null,
  state: string | null,
  prisma: PrismaClient
): Promise<{ id: string } | null> {
  if (!city) return null

  const normState = normalizeState(state)

  const loc = await prisma.location.findFirst({
    where: {
      type: "CITY",
      name: { equals: city, mode: "insensitive" },
      ...(normState ? { OR: [
        { state: normState },
        { state: state },
      ] } : {}),
    },
    select: { id: true },
  })

  if (loc) return loc

  if (state) {
    const locStateOnly = await prisma.location.findFirst({
      where: { type: "CITY", name: { equals: city, mode: "insensitive" } },
      select: { id: true },
    })
    return locStateOnly
  }

  return null
}

function normalizeVenueName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*(hotel|convention center|resort|arena|casino|fairgrounds|museum|stadium|expo)\s*/gi, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const aWords = new Set(a.split(/\s+/))
  const bWords = new Set(b.split(/\s+/))
  const intersection = [...aWords].filter((w) => bWords.has(w)).length
  const union = new Set([...aWords, ...bWords]).size

  if (union === 0) return 0
  const jaccard = intersection / union

  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.includes(shorter)) return jaccard * 0.9 + 0.1

  const lev = levenshtein(a, b)
  const lenNorm = 1 - lev / Math.max(a.length, b.length)

  return jaccard * 0.5 + lenNorm * 0.5
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1]
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

// ─── Ingest Script Venue Matching ───────────────────────────────────────────
// Centralized function for ingest scripts to match venues with normalization
// and optional city-scoping. Replaces the ad-hoc venueMap.get() pattern.

export interface VenueMatchResult {
  venueId: string | null
  matchType: "venue_matched" | "location_matched"
}

/**
 * Match a venue name to an existing VENUE location.
 *
 * Strategy:
 * 1. Exact case-insensitive match (fast path via Map)
 * 2. Normalized match (strip abbreviations, common words, special chars)
 * 3. Fuzzy match with similarity >= 0.75
 *
 * If cityHint is provided, prefers venues in that city.
 */
export function matchVenue(
  venueName: string | null | undefined,
  cityHint: string | null | undefined,
  venueMap: Map<string, { id: string; name: string; city: string | null }>,
  allVenues?: { id: string; name: string; city: string | null }[],
): VenueMatchResult {
  if (!venueName?.trim()) {
    return { venueId: null, matchType: "location_matched" }
  }

  const raw = venueName.trim()

  // 1. Exact case-insensitive match (fast path)
  const exactMatch = venueMap.get(raw.toLowerCase())
  if (exactMatch) {
    return { venueId: exactMatch.id, matchType: "venue_matched" }
  }

  // 2. Normalized match
  const norm = normalizeIngestVenueName(raw)
  for (const [key, venue] of venueMap) {
    if (normalizeIngestVenueName(venue.name) === norm) {
      // Prefer city-scoped match if hint provided
      if (cityHint && venue.city && venue.city.toLowerCase().includes(cityHint.toLowerCase())) {
        return { venueId: venue.id, matchType: "venue_matched" }
      }
      return { venueId: venue.id, matchType: "venue_matched" }
    }
  }

  // 3. Fuzzy match (only if allVenues provided)
  if (allVenues && allVenues.length > 0) {
    let best: { id: string; score: number } | null = null
    for (const venue of allVenues) {
      const score = similarity(norm, normalizeIngestVenueName(venue.name))
      if (score >= 0.75 && (!best || score > best.score)) {
        // Prefer city-scoped match
        if (cityHint && venue.city && venue.city.toLowerCase().includes(cityHint.toLowerCase())) {
          best = { id: venue.id, score }
        } else if (!cityHint || !best) {
          best = { id: venue.id, score }
        }
      }
    }
    if (best) {
      return { venueId: best.id, matchType: "venue_matched" }
    }
  }

  return { venueId: null, matchType: "location_matched" }
}

/**
 * Normalize a venue name for ingest matching.
 * Strips abbreviations, common venue type words, special chars.
 */
function normalizeIngestVenueName(name: string): string {
  return name
    .toLowerCase()
    // Strip common abbreviations
    .replace(/\b(st|ave|blvd|dr|rd|ln|ct|pl|pkwy|hwy)\b\.?/g, "")
    // Strip venue type words
    .replace(/\b(hotel|convention center|resort|arena|casino|fairgrounds|museum|stadium|expo|center|centre)\b/g, "")
    // Strip non-alphanumeric
    .replace(/[^a-z0-9\s]/g, "")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Build a venue Map from an array of venues for use with matchVenue().
 */
export function buildVenueMap(
  venues: { id: string; name: string; city: string | null }[],
): Map<string, { id: string; name: string; city: string | null }> {
  const map = new Map<string, { id: string; name: string; city: string | null }>()
  for (const v of venues) {
    map.set(v.name.toLowerCase(), v)
  }
  return map
}
