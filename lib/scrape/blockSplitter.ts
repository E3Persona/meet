import { extractDateFromMarkdown } from "./dateExtractor"

export interface RawBlock {
  blockHash: string
  identityKey: string
  rawText: string
  detailUrl: string | null
  venueText: string | null
  dateText: string | null
  slugName: string | null          // event name extracted from detail URL slug
}

export interface SplitResult {
  blocks: RawBlock[]
  fullHash: string
}

const EVENT_NAME_FROM_SLUG = /\/events\/detail\/([a-z0-9]+(?:-[a-z0-9]+)*)-\d+$/i

function formatDateHint(text: string): string | null {
  const range = extractDateFromMarkdown(text)
  if (!range) return null
  return range.start.toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  }) + (range.end && range.end.getTime() !== range.start.getTime()
    ? ` - ${range.end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
    : "")
}

function extractEventNameFromSlug(text: string): string | null {
  const m = text.match(EVENT_NAME_FROM_SLUG)
  if (!m) return null
  return m[1]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function extractDetailUrl(text: string): string | null {
  // Find detail page URLs (not image URLs)
  const urls = [...text.matchAll(/https?:\/\/[^\s\)"'\]]+/g)].map((m) => m[0])
  // Prefer URLs with /events/detail/ in them
  const detail = urls.find((u) => u.includes("/events/detail/"))
  return detail ?? urls[0] ?? null
}

export function splitIntoBlocks(markdown: string, _directoryBaseUrl: string): SplitResult {
  const fullHash = hashContent(markdown)

  const pageDate = formatDateHint(markdown)

  const MAX_CHUNK = 3000
  const OVERLAP = 200

  if (markdown.length <= MAX_CHUNK) {
    const detailUrl = extractDetailUrl(markdown)
    return {
      blocks: [{
        blockHash: fullHash,
        identityKey: fullHash,
        rawText: markdown,
        detailUrl,
        venueText: null,
        dateText: pageDate,
        slugName: detailUrl ? extractEventNameFromSlug(detailUrl) : null,
      }],
      fullHash,
    }
  }

  const blocks: RawBlock[] = []
  let offset = 0

  while (offset < markdown.length) {
    const chunk = markdown.slice(offset, offset + MAX_CHUNK)
    const chunkHash = hashContent(chunk)
    const detailUrl = extractDetailUrl(chunk)
    blocks.push({
      blockHash: chunkHash,
      identityKey: chunkHash,
      rawText: chunk,
      detailUrl,
      venueText: null,
      dateText: pageDate ?? formatDateHint(chunk),
      slugName: detailUrl ? extractEventNameFromSlug(detailUrl) : null,
    })
    offset += MAX_CHUNK - OVERLAP
  }

  return { blocks, fullHash }
}

export function extractAllDetailUrls(markdown: string): string[] {
  const seen = new Set<string>()
  const urls: string[] = []
  const regex = /https?:\/\/[^\s\)"'\]]+/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(markdown)) !== null) {
    const url = match[0]
    if (url.includes("/events/detail/") && !seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }
  return urls
}

export function eventNameFromUrl(url: string): string | null {
  const m = url.match(EVENT_NAME_FROM_SLUG)
  if (!m) return null
  return m[1]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export function hashContent(content: string): string {
  let hash = 5381
  const normalized = content.toLowerCase().replace(/\s+/g, " ")
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i)
    hash = hash >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}
