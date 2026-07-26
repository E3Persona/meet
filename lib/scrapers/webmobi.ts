const API_BASE = "https://www.webmobi.com/api/discovery/events"

export interface WebmobiEvent {
  id: string
  name: string
  description: string | null
  startDate: string | null
  endDate: string | null
  city: string | null
  country: string | null
  category: string | null
  topics: string[]
  website_url: string | null
  isVirtual: boolean
  isHybrid: boolean
}

interface RawEvent {
  id: string
  name: string
  description: string | null
  start_date: string | null
  end_date: string | null
  location_city: string | null
  location_country: string | null
  category: string | null
  topics: string[]
  website_url: string | null
  is_virtual: boolean
  is_hybrid: boolean
}

export async function fetchWebmobiEvents(): Promise<WebmobiEvent[]> {
  const url = `${API_BASE}?location=north-america&sortBy=date`
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Webmobi API HTTP ${res.status}`)
  const data = await res.json() as { success: boolean; events: RawEvent[] }
  if (!data.success || !Array.isArray(data.events)) {
    throw new Error("Webmobi API returned unexpected structure")
  }

  return data.events
    .filter((e) => e.location_country === "USA")
    .map((e) => ({
      id: e.id,
      name: e.name,
      description: e.description ?? null,
      startDate: e.start_date ?? null,
      endDate: e.end_date ?? null,
      city: e.location_city ?? null,
      country: e.location_country ?? null,
      category: e.category ?? null,
      topics: e.topics ?? [],
      website_url: e.website_url ?? null,
      isVirtual: e.is_virtual ?? false,
      isHybrid: e.is_hybrid ?? false,
    }))
}
