export function monthIndex(name: string): number {
  const m: Record<string, number> = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11,
  }
  return m[name.toLowerCase().slice(0, 9)] ?? m[name.toLowerCase().slice(0, 3)] ?? -1
}

export interface DateRange { start: Date; end: Date }

export function extractDateRange(dateStr: string | null): DateRange | null {
  if (!dateStr) return null

  const monthRange = dateStr.match(
    /^([A-Z][a-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2}),?\s*(\d{4})$/,
  )
  if (monthRange) {
    const month = monthIndex(monthRange[1])
    if (month !== -1) {
      return {
        start: new Date(+monthRange[4], month, +monthRange[2]),
        end: new Date(+monthRange[4], month, +monthRange[3]),
      }
    }
  }

  const monthRangeSlash = dateStr.match(
    /^([A-Z][a-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2})\s*[/\-]\s*(\d{4})$/,
  )
  if (monthRangeSlash) {
    const month = monthIndex(monthRangeSlash[1])
    if (month !== -1) {
      return {
        start: new Date(+monthRangeSlash[4], month, +monthRangeSlash[2]),
        end: new Date(+monthRangeSlash[4], month, +monthRangeSlash[3]),
      }
    }
  }

  const singleDate = dateStr.match(/^([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})$/)
  if (singleDate) {
    const month = monthIndex(singleDate[1])
    if (month !== -1) {
      const d = new Date(+singleDate[3], month, +singleDate[2])
      return isNaN(d.getTime()) ? null : { start: d, end: d }
    }
  }

  const numeric = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (numeric) {
    const d = new Date(+numeric[3], +numeric[1] - 1, +numeric[2])
    return isNaN(d.getTime()) ? null : { start: d, end: d }
  }

  const numericRange = dateStr.match(
    /^(\d{1,2})[\/\-](\d{1,2})\s*[-–]\s*(\d{1,2})[\/\-](\d{4})$/,
  )
  if (numericRange) {
    const s = new Date(+numericRange[4], +numericRange[1] - 1, +numericRange[2])
    const e = new Date(+numericRange[4], +numericRange[1] - 1, +numericRange[3])
    return (!isNaN(s.getTime()) && !isNaN(e.getTime())) ? { start: s, end: e } : null
  }

  return null
}

const NOISE_KEYWORDS = /\b(?:Posted|Updated|Last\s+(?:modified|updated|changed)|Modified|Uploaded|Published|Calendar|Share|Print)\b/i

const DATE_ON_LINE = /(?:^|\n)\s*(?:\*\s+)?(?:Date|When|Dates?)\s*:?\s*([A-Z][a-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2}),?\s*(\d{4})/im

const DATE_ON_LINE_SINGLE = /(?:^|\n)\s*(?:\*\s+)?(?:Date|When|Dates?)\s*:?\s*([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})/im

const GENERIC_RANGE = /([A-Z][a-z]+)\s+(\d{1,2})\s*[-–]\s*(\d{1,2}),?\s*(\d{4})/

const GENERIC_SINGLE = /([A-Z][a-z]+)\s+(\d{1,2}),?\s*(\d{4})/

const NUMERIC_DATE = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/

function tryMatch(text: string, p: RegExp): DateRange | null {
  const m = p.exec(text)
  if (!m) return null
  if (p === DATE_ON_LINE || p === GENERIC_RANGE) {
    const mo = monthIndex(m[1]); if (mo === -1) return null
    return { start: new Date(+m[4], mo, +m[2]), end: new Date(+m[4], mo, +m[3]) }
  }
  if (p === DATE_ON_LINE_SINGLE || p === GENERIC_SINGLE) {
    const mo = monthIndex(m[1]); if (mo === -1) return null
    const d = new Date(+m[3], mo, +m[2])
    return isNaN(d.getTime()) ? null : { start: d, end: d }
  }
  if (p === NUMERIC_DATE) {
    const d = new Date(+m[3], +m[1] - 1, +m[2])
    return isNaN(d.getTime()) ? null : { start: d, end: d }
  }
  return null
}

function matchOnCleanLines(text: string, p: RegExp): DateRange | null {
  for (const line of text.split(/\n+/)) {
    if (NOISE_KEYWORDS.test(line)) continue
    const r = tryMatch(line, p)
    if (r) return r
  }
  return null
}

export function extractDateFromMarkdown(markdown: string): DateRange | null {
  const excerpt = markdown.slice(0, 8000)
  const text = excerpt

  let r = tryMatch(text, DATE_ON_LINE)
  if (r) return r
  r = tryMatch(text, DATE_ON_LINE_SINGLE)
  if (r) return r

  r = matchOnCleanLines(text, GENERIC_RANGE)
  if (r) return r
  r = matchOnCleanLines(text, GENERIC_SINGLE)
  if (r) return r
  r = matchOnCleanLines(text, NUMERIC_DATE)
  if (r) return r

  r = tryMatch(text, GENERIC_RANGE)
  if (r) return r
  r = tryMatch(text, GENERIC_SINGLE)
  if (r) return r

  return null
}
