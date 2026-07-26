const API_BASE = "https://www.eventbrite.com/api/v3/destination/events"
const PAGE_SIZE = 300
const EXPANDS = "event_sales_status,image,primary_venue,saves,ticket_availability,primary_organizer,primary_organizer.image,public_collections"

export interface EventbriteApiVenue {
  name: string
  city: string | null
  region: string | null
  country: string | null
  address: string | null
  postalCode: string | null
  latitude: number | null
  longitude: number | null
}

export interface EventbriteApiOrganizer {
  name: string | null
  url: string | null
  summary: string | null
  imageUrl: string | null
  followers: number | null
}

export interface EventbriteApiEvent {
  id: string
  name: string
  summary: string | null
  description: string | null
  url: string
  startDate: string | null
  endDate: string | null
  startTime: string | null
  endTime: string | null
  timezone: string | null
  status: string | null
  isOnline: boolean
  venue: EventbriteApiVenue | null
  organizer: EventbriteApiOrganizer | null
  category: string | null
  tags: string[]
  sourceSite: "eventbrite.com"
}

interface RawApiEvent {
  id: string
  name: string
  summary: string | null
  description: string | null
  url: string
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  timezone: string | null
  status: string | null
  is_online_event: boolean
  primary_venue: {
    name: string
    address: {
      city: string
      region: string
      country: string
      localized_address_display: string
      postal_code: string
      latitude: string
      longitude: string
    }
  } | null
  primary_organizer: {
    name: string
    url: string
    summary: string | null
    image?: { url: string }
    num_followers: number | null
  } | null
  tags: Array<{ display_name: string }>
  category?: { name: string }
  public_collections: {
    creator_collections: {
      collections: Array<{ event_ids: string[] }>
    }
  } | null
}

export interface EventbriteApiResult {
  events: EventbriteApiEvent[]
  discoveredIds: string[]
}

function buildUrl(eventIds: string[]): string {
  return `${API_BASE}/?event_ids=${eventIds.join(",")}&page_size=${PAGE_SIZE}&expand=${EXPANDS}`
}

function mapEvent(raw: RawApiEvent): EventbriteApiEvent {
  const v = raw.primary_venue
  const o = raw.primary_organizer
  return {
    id: raw.id,
    name: raw.name,
    summary: raw.summary ?? null,
    description: raw.description ?? null,
    url: raw.url,
    startDate: raw.start_date ?? null,
    endDate: raw.end_date ?? null,
    startTime: raw.start_time ?? null,
    endTime: raw.end_time ?? null,
    timezone: raw.timezone ?? null,
    status: raw.status ?? null,
    isOnline: raw.is_online_event ?? false,
    venue: v ? {
      name: v.name,
      city: v.address?.city ?? null,
      region: v.address?.region ?? null,
      country: v.address?.country ?? null,
      address: v.address?.localized_address_display ?? null,
      postalCode: v.address?.postal_code ?? null,
      latitude: v.address?.latitude ? parseFloat(v.address.latitude) : null,
      longitude: v.address?.longitude ? parseFloat(v.address.longitude) : null,
    } : null,
    organizer: o ? {
      name: o.name ?? null,
      url: o.url ?? null,
      summary: o.summary ?? null,
      imageUrl: o.image?.url ?? null,
      followers: o.num_followers ?? null,
    } : null,
    category: raw.category?.name ?? null,
    tags: (raw.tags ?? []).map((t) => t.display_name).filter(Boolean),
    sourceSite: "eventbrite.com",
  }
}

function extractCollectionIds(raw: RawApiEvent): string[] {
  const ids: string[] = []
  const collections = raw.public_collections?.creator_collections?.collections
  if (!collections) return ids
  for (const c of collections) {
    for (const eid of c.event_ids ?? []) {
      if (eid && eid !== raw.id) ids.push(eid)
    }
  }
  return ids
}

export async function fetchBatch(eventIds: string[]): Promise<{
  events: EventbriteApiEvent[]
  collectionIds: string[]
}> {
  if (eventIds.length === 0) return { events: [], collectionIds: [] }

  const url = buildUrl(eventIds)
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Eventbrite API HTTP ${res.status}`)
  const data = await res.json() as { events: RawApiEvent[] }

  const events: EventbriteApiEvent[] = []
  const allCollectionIds = new Set<string>()

  for (const raw of data.events ?? []) {
    events.push(mapEvent(raw))
    const collIds = extractCollectionIds(raw)
    for (const id of collIds) allCollectionIds.add(id)
  }

  return { events, collectionIds: [...allCollectionIds] }
}

export async function discoverEvents(
  seedIds: string[],
  maxDepth = 3,
  maxTotalIds = 1000,
): Promise<EventbriteApiEvent[]> {
  const seen = new Set<string>(seedIds)
  const queue = [...seedIds]
  const allEvents: Map<string, EventbriteApiEvent> = new Map()
  let depth = 0

  while (queue.length > 0 && depth < maxDepth && allEvents.size < maxTotalIds) {
    depth++
    const batch = queue.splice(0, PAGE_SIZE)
    const { events, collectionIds } = await fetchBatch(batch)

    for (const ev of events) {
      if (!allEvents.has(ev.id)) allEvents.set(ev.id, ev)
    }

    if (depth < maxDepth && allEvents.size < maxTotalIds) {
      for (const id of collectionIds) {
        if (!seen.has(id) && !allEvents.has(id)) {
          seen.add(id)
          queue.push(id)
        }
      }
    }

    console.log(`[eventbrite-api] Depth ${depth}: fetched ${batch.length} IDs → ${events.length} events, ${collectionIds.length} new IDs discovered (queue: ${queue.length})`)

    if (queue.length === 0) break
  }

  return [...allEvents.values()]
}
