export interface SearchResult {
  title: string
  url: string
  snippet: string | null
  publishedDate: string | null
  page: number
  position: number
  eventDate: string // ISO date string used for window filtering
}

const MONTH_NAMES = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
]

export function parseDateFromText(
  text: string | null | undefined
): Date | null {
  if (!text) return null
  const value = text.trim()

  const isoMatch = value.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/)
  if (isoMatch) {
    const year = Number(isoMatch[1])
    const month = Number(isoMatch[2])
    const day = Number(isoMatch[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      return date
    }
  }

  const monthMatch = value.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i
  )
  if (monthMatch) {
    const month = MONTH_NAMES.indexOf(monthMatch[1].slice(0, 3).toLowerCase())
    const day = Number(monthMatch[2])
    const year = Number(monthMatch[3])
    if (month >= 0 && day >= 1 && day <= 31) {
      return new Date(Date.UTC(year, month, day))
    }
  }

  return null
}

// Accepts anything from the start of the current month through `monthsAhead`
// months forward (exclusive upper bound). Rejects anything in the past.
export function isWithinWindow(
  date: Date,
  monthsAhead: number,
  now = new Date()
): boolean {
  const windowStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))
  const windowEnd = new Date(
    Date.UTC(now.getFullYear(), now.getMonth() + monthsAhead, 1)
  )
  return (
    date.getTime() >= windowStart.getTime() &&
    date.getTime() < windowEnd.getTime()
  )
}

export function normalizeUrl(url: string): string {
  try {
    return new URL(url).toString().replace(/\/$/, "")
  } catch {
    return url.trim().replace(/\/$/, "")
  }
}

export function isValidUrl(url: string): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = normalizeUrl(result.url).toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}
