# Milestone 1 — Event Pipeline Dashboard

## Overview

A dashboard application that replaces a manual Excel workflow for tracking meetings, conventions, and tradeshows across venues. It manages locations, discovers events via web scraping, and provides a UI for reviewing and updating organizer contact details.

**Stack:** Next.js 15 (App Router) · TypeScript · Prisma + PostgreSQL (Supabase) · Puppeteer · SheetJS (Excel export)

---

## Data Model

| Model | Purpose |
|-------|---------|
| **Location** | Venues / convention centers (name, city, state, address, source URL) |
| **SearchTerm** | Per-location keywords used for event discovery |
| **Event** | Discovered events (name, dates, source URL, location) with human-editable organizer fields (name, title, email, phone) and status (New / Reviewed / Contacted) |
| **EventContact** | Multi-contact support per event (name, title, email, phone, confidence) |
| **IngestionRun** | Tracks every execution (started/finished time, trigger type, status, counts) |
| **IngestConfig** | Per-scraper settings (max pages, active toggle) |
| **SourceSite** | Known event directories with scraping profiles |
| **SearchTemplate** | Query templates expanded per location at ingestion time |

---

## Scrapers (10 total)

All scrapers use Puppeteer (headless Chrome) except where noted. Results are saved directly to the database.

| Scraper | Site | Method | What It Extracts |
|---------|------|--------|-----------------|
| **ICA** | internationalconferencealerts.com | Puppeteer | Events by city/month, venue, email, phone, deadlines. Decodes Cloudflare-obfuscated emails. 18 US cities mapped to ICA slugs. |
| **ConferenceNext** | conferencenext.com | Puppeteer | Schema.org-tagged event cards, official website, organizer info, email. 21 city/state slugs. |
| **AllConferenceAlert** | allconferencealert.net | Puppeteer | "Load More" pagination, country/city listing pages, detail page contact extraction. |
| **Tradefest** | tradefest.io | Puppeteer | Ranked trade show listings, venue, organizer, ratings, attendee/exhibitor counts. |
| **Showsbee** | showsbee.com | Puppeteer | Category/city listings, venue/organizer tables with address, phone, website. |
| **EventsEye** | eventseye.com | Puppeteer | Upcoming trade fair table, dates/cities/venues, organizer contact details. |
| **ASAE** | asaecenter.org | Puppeteer + Jina AI | PheedLoop embed calendar, "Load More" expansion, detail page contact via Jina AI. |
| **Black Meetings** | blackmeetingsandtourism.com | Cheerio (plain fetch) | Magazine article listings, convention center venue pages (exhibit space, ballroom, meeting rooms, contacts). |
| **SGMP** | sgmp.org | Cheerio + Jina AI fallback | JEvents calendar, month-by-month navigation, venue/location/contact extraction. |
| **Trade Show Calendar** | thetradeshowcalendar.com | Puppeteer + Jina AI | Country search form, paginated results, DC/PHL/BAL region filter, organizer contact via Jina AI. |

---

## API Routes

### Ingest (`/api/ingest/`)
- **`/run`** — Main ingestion engine: search pipeline (Tavily / Brave / DuckDuckGo → Jina / WebPeel / Firecrawl → LLM extraction). Handles both scheduled and manual triggers.
- **`/ica`, `/cn`, `/aca`, `/tf`, `/showsbee`, `/eventseye`, `/asae`, `/blackmeetings`, `/sgmp`, `/thetradeshowcalendar`** — Individual per-scraper endpoints.
- **`/config`** — Per-scraper settings management.
- **`/schedules`** — CRUD for named cron schedules.

### Events (`/api/events/`)
- **`GET /`** — List events with filters (location, status, search, has-contact) and pagination.
- **`PATCH /[id]`** — Inline edit organizer fields and status.
- **`GET /export`** — Excel export (.xlsx) matching the original spreadsheet column order.
- **`/[id]/find-contact`** — Per-event contact finder via search + LLM.
- **`/find-all-contacts`** — Batch contact finder for up to 20 events.
- **`/[id]/contacts`** — CRUD for multi-contact per event.

### Other
- **`/api/stats`** — Computed dashboard stats.
- **`/api/runs`** — Run history (last 50).
- **`/api/locations`** — Location CRUD.

---

## Dashboard UI

### Views (single-page, sidebar navigation)

| View | Component | Features |
|------|-----------|----------|
| **Events** | StatsRow + EventsTable | 6 metric cards (total locations, total events, new this week, etc.), search/filter, sort, inline editing, status dropdown, Excel export, "Find All Contacts" batch button, "Delete All" |
| **Locations** | LocationsManager | CRUD for venues |
| **Templates** | TemplatesManager | CRUD for search query templates with `{CITY}`, `{VENUE}` placeholders |
| **Sources** | SourceSitesManager | Manage source site records, configure scraping profiles |
| **Directories** | DirectoriesManager | Configure CSS selectors for deterministic scraping |
| **Scrapers** | ScrapersPanel | Grid of 10 scraper cards, each with "Run Now" button wired to its API route |
| **Schedules** | ScheduleManager | CRUD for cron schedules with location/template/source-site assignments |
| **Runs** | RunHistoryTable | Last 50 ingestion runs with status badges, trigger type, error display |

### Key UI Components
- **ContactFinderModal** — View/edit/add/delete contacts per event with confidence badges. "Search for Contacts" triggers LLM-based extraction.
- **RunNowButton** — Triggers the main ingestion pipeline on demand.

---

## Search Pipeline (automated ingestion)

1. **Query generation** — Builds 6 months of queries per location from search templates + search keywords
2. **Search** — Tiered: Tavily (33/day) → Brave (66/day) → DuckDuckGo (unlimited)
3. **Scrape** — Tiered: Jina AI (200/day) → WebPeel (125/day) → Firecrawl (16/day)
4. **LLM extraction** — Groq (Llama 3.3 70B) with OpenRouter fallback parses scraped content into structured events
5. **Location matching** — Matches discovered events to known locations
6. **Deduplication** — By `eventName` + `locationId` + `eventDateStart`
7. **10 excluded domains** — Sites covered by dedicated scrapers are excluded from the search pipeline

---

## Scheduling

- **Vercel Cron:** Daily at 6:00 AM via `vercel.json`
- Scheduled runs have stricter limits (5 locations, 50 queries max) and frequency filtering (max 2x/30 days per location/search term)
- Manual runs bypass frequency limits
- Named cron schedules configurable via the Schedules UI

---

## Hard Boundaries (per project requirements)

- **Automated half:** Event discovery (name, venue, dates, source URL)
- **Manual-only half:** Organizer contact info (name, title, phone, email) — never auto-populated by scrapers, only by human via inline edit or optional "Find Contact" button
- **No scraping of Google results pages**
- **No bulk personal-data harvesting** from third-party sites
- Scrapers use licensed search APIs (Tavily, Serper.dev, Brave) and robots.txt-respecting scrapers (Firecrawl, Jina AI)

---

## Seed Data

The database ships with:
- 20+ major convention center locations (Gaylord properties, McCormick Place, Javits Center, etc.)
- 70+ venue master list entries across DC, Philadelphia, Baltimore, National Harbor regions
- 51 search templates
- 43 source site profiles
- 6 pre-configured scraper ingest configs

---

## Files Added / Modified

| Category | Count | Paths |
|----------|-------|-------|
| Scrapers | 10 files | `lib/scrapers/{ica,conferencenext,allconferencealert,tradefest,showsbee,eventseye,asae,blackmeetings,sgmp,thetradeshowcalendar}.ts` |
| Ingestion scripts | 11 files | `scripts/ingest-{ica,cn,aca,tf,showsbee,eventseye,asae,blackmeetings,sgmp,thetradeshowcalendar}.ts` + search pipeline |
| API routes | 15 files | `app/api/ingest/{run,ica,cn,aca,tf,showsbee,eventseye,asae,blackmeetings,sgmp,thetradeshowcalendar,config,schedules}/route.ts` |
| Dashboard UI | 8 files | `components/dashboard/{sidebar,stats-row,events-table,run-history-table,scrapers-panel,contact-finder-modal,run-now-button}.tsx` |
| Data management | 4 files | `components/{locations,source-sites,directories,schedules}/*-manager.tsx` |
| Infrastructure | 5 files | `lib/{providers,scrape,ingest}/*`, `lib/contact-finder.ts`, `lib/run-scraper.ts`, `prisma/schema.prisma`, `prisma/seed.ts` |
| Total | ~40+ files | Full-stack application |
