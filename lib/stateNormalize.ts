const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
}

const VALID_CODES = new Set(Object.values(STATE_NAME_TO_CODE))

/**
 * Normalize any state value (full name, 2-letter code, mixed case) to a
 * 2-letter uppercase code. Returns null if the input is empty or unrecognised.
 */
export function normalizeState(state: string | null | undefined): string | null {
  if (!state) return null
  const trimmed = state.trim()
  if (!trimmed) return null

  const upper = trimmed.toUpperCase()
  if (VALID_CODES.has(upper)) return upper

  const code = STATE_NAME_TO_CODE[trimmed.toLowerCase()]
  return code ?? null
}

/**
 * Compare two state values after normalisation.
 * "Maryland" matches "MD", "pa" matches "Pennsylvania", etc.
 */
export function statesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeState(a)
  const nb = normalizeState(b)
  if (!na || !nb) return false
  return na === nb
}

/**
 * Build a canonical location-map key: "city|STATE_CODE" (lowercase).
 * Pass through city normalisation as-is; only normalise the state part.
 */
export function locationKey(city: string | null | undefined, state: string | null | undefined): string {
  return `${(city ?? "").toLowerCase()}|${(normalizeState(state) ?? "").toLowerCase()}`
}
