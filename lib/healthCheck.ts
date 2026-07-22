import { createJinaProvider } from "@/lib/providers/scrape/jina"
import { splitIntoBlocks } from "@/lib/scrape/blockSplitter"

const jina = createJinaProvider()

export interface HealthResult {
  sourceId: string
  url: string
  venueName: string
  status: "valid" | "broken" | "suggested_correction"
  suggestedUrl: string | null
  discoveryMethod: string | null
  discoveryConfidence: number | null
  blocksFound: number
  errorMessage: string | null
}

const CONTENT_MIN_CHARS = 200
const DATE_PATTERN = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i
const CANDIDATE_PATH_SUFFIXES = [
  "/events",
  "/calendar",
  "/upcoming-events",
  "/events/",
  "/whats-on",
  "/things-to-do/events",
  "/entertainment/event-calendar",
  "/event-calendar",
  "/schedule",
]

export async function checkSource(
  sourceUrl: string,
  venueName: string,
  sourceId: string
): Promise<HealthResult> {
  const result = await validateUrl(sourceUrl)
  if (result.status === "valid") return { sourceId, url: sourceUrl, venueName, ...result }

  const { host, pathname } = parseUrl(sourceUrl)
  const baseUrl = `https://${host}`

  const candidates: Array<{ url: string; method: string }> = []

  for (const suffix of CANDIDATE_PATH_SUFFIXES) {
    candidates.push({ url: `${baseUrl}${suffix}`, method: `path:${suffix}` })
    candidates.push({ url: `${baseUrl}${pathname.replace(/\/[^/]*$/, "")}${suffix}`, method: `relative:${suffix}` })
  }

  const sitemapUrl = `${baseUrl}/sitemap.xml`
  try {
    const sitemapResult = await jina.scrape(sitemapUrl, { timeout: 10000 })
    if (sitemapResult.markdown && sitemapResult.markdown.length > 100) {
      const eventUrls = extractEventUrlsFromSitemap(sitemapResult.markdown, host)
      for (const eu of eventUrls.slice(0, 5)) {
        candidates.push({ url: eu, method: "sitemap" })
      }
    }
  } catch {}

  const scored = await Promise.all(
    candidates.map(async (c) => {
      const vr = await validateUrl(c.url)
      return { ...c, ...vr, score: vr.status === "valid" ? 2 : vr.blocksFound > 0 ? 1 : 0 }
    })
  )

  scored.sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (best && best.score > 0) {
    return {
      sourceId,
      url: sourceUrl,
      venueName,
      status: "suggested_correction",
      suggestedUrl: best.url,
      discoveryMethod: best.discoveryMethod,
      discoveryConfidence: best.score === 2 ? 0.9 : 0.6,
      blocksFound: best.blocksFound,
      errorMessage: null,
    }
  }

  return {
    sourceId,
    url: sourceUrl,
    venueName,
    status: "broken",
    suggestedUrl: null,
    discoveryMethod: null,
    discoveryConfidence: null,
    blocksFound: 0,
    errorMessage: result.errorMessage ?? "No valid calendar page found",
  }
}

async function validateUrl(url: string): Promise<Omit<HealthResult, "sourceId" | "url" | "venueName">> {
  try {
    const result = await jina.scrape(url, { timeout: 20000 })
    if (!result.markdown) {
      return { status: "broken", suggestedUrl: null, discoveryMethod: null, discoveryConfidence: null, blocksFound: 0, errorMessage: result.error ?? "No content" }
    }

    const text = result.markdown
    if (text.length < CONTENT_MIN_CHARS) {
      return { status: "broken", suggestedUrl: null, discoveryMethod: null, discoveryConfidence: null, blocksFound: 0, errorMessage: "Content too short (likely error page)" }
    }

    if (!DATE_PATTERN.test(text)) {
      return { status: "broken", suggestedUrl: null, discoveryMethod: null, discoveryConfidence: null, blocksFound: 0, errorMessage: "No date patterns found" }
    }

    const { blocks } = splitIntoBlocks(text, url)
    if (blocks.length < 2) {
      return { status: "broken", suggestedUrl: null, discoveryMethod: null, discoveryConfidence: null, blocksFound: 0, errorMessage: `Only ${blocks.length} block(s) found — not a calendar listing` }
    }

    return { status: "valid", suggestedUrl: null, discoveryMethod: null, discoveryConfidence: null, blocksFound: blocks.length, errorMessage: null }
  } catch (err) {
    return { status: "broken", suggestedUrl: null, discoveryMethod: null, discoveryConfidence: null, blocksFound: 0, errorMessage: String(err) }
  }
}

function extractEventUrlsFromSitemap(xml: string, host: string): string[] {
  const urlMatches = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)]
  const eventKeywords = /event|calendar|whats-on|schedule|things-to-do/i
  return urlMatches
    .map((m) => m[1].trim())
    .filter((u) => {
      try {
        const uHost = new URL(u).hostname
        return uHost === host && eventKeywords.test(u)
      } catch {
        return false
      }
    })
}

function parseUrl(url: string): { host: string; pathname: string } {
  try {
    const u = new URL(url)
    return { host: u.hostname, pathname: u.pathname }
  } catch {
    return { host: "", pathname: "/" }
  }
}
