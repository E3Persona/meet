// Source of truth for all domains that have dedicated scrapers.
// Add new dedicated scraper domains here and they will be excluded
// from generic LLM processing and directory scraping everywhere.

export const DEDICATED_SCRAPER_DOMAINS = [
  "allconferencealert.net",
  "asaecenter.org",
  "blackmeetingsandtourism.com",
  "conferencenext.com",
  "conventionplanit.com",
  "eventseye.com",
  "exhibitcitynews.com",
  "infosec-conferences.com",
  "internationalconferencealerts.com",
  "sgmp.org",
  "showsbee.com",
  "thetradeshowcalendar.com",
  "tradefest.io",
  "philadelphiaunion.com",
  "rrbitc.com",
  "tickets.gaylordnational.com",
  "eventsdc.com",
  "tradefairdates.com",
] as const

export type DedicatedScraperDomain = typeof DEDICATED_SCRAPER_DOMAINS[number]

export function isExcludedDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return DEDICATED_SCRAPER_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`)
    )
  } catch {
    return false
  }
}

export function isExcludedHostname(hostname: string): boolean {
  return DEDICATED_SCRAPER_DOMAINS.some(
    domain => hostname === domain || hostname.endsWith(`.${domain}`)
  )
}
