# Milestone 2 — Event Pipeline Dashboard

## Overview

Major expansion of the platform: 4 new scrapers, a full multi-provider search/scrape pipeline with credit tracking, real-time progress streaming, deterministic directory scraping via CSS selectors, a generic LLM scraper for any source site, per-template search execution with city/venue selection, Excel import, multi-contact management, source site testing, and a complete reusable UI component library.

**Stack:** Next.js 15 (App Router) · TypeScript · Prisma + PostgreSQL (Supabase) · Multi-provider pipeline (Tavily / Brave / DuckDuckGo / Jina / WebPeel / Firecrawl) · Dual LLM extraction (Groq + OpenRouter) · SheetJS

---

## New Scrapers (4 added — 14 total)

| Scraper | Site | Method | What It Extracts |
|---------|------|--------|-----------------|
| **ConventionPlanit** | conventionplanit.com | Cheerio + Jina AI fallback | Venue directory: name, address, rooms, sq ft, contact details. Auto-creates VENUE locations under active cities. |
| **InfoSec Conferences** | infosec-conferences.com | Cheerio (plain fetch) | Cybersecurity events by state. Event cards with name, dates, organizer, expected attendees, city. 50-state slug mapping. |
| **Generic LLM** | Any source site | External API + LLM | Scrapes any source site without a dedicated scraper. Calls `/scrape` and `/search` endpoints. Rate-limited (15 req/min). Skips dedicated domains. |
| **Dedicated Domains** | — | Registry | Central registry of 13 domains excluded from generic processing. Exports `isExcludedDomain()` and `isExcludedHostname()`. |

---

## Search Pipeline Upgrades

### Per-Template Execution
- **Run button on every template/term** in the Templates Manager
- CITY/VENUE-scoped templates open a **city/venue picker dialog** — select which locations to run against
- GLOBAL templates and pinned terms run immediately
- Results stream via **ProgressDialog** with live log polling

### Template ID Filtering
- `buildSearchQueries()` accepts `templateIds` to run only specific templates
- `/api/ingest/run` accepts `templateIds` in request body
- Enables targeted, scoped search runs without affecting other templates

### Source Site Targeting
- Run the search pipeline scoped to a single source site via `sourceSiteId`
- Manual source sites record check timestamps (14-day freshness window)
- Automated source sites run `site:domain CityName events` queries

### Frequency Limiting
- Scheduled runs: max 2 runs per location per 30 days
- History tracked in `IngestionSchedule.runHistory`
- Manual runs bypass frequency limits

---

## Provider Infrastructure (all new)

### ProviderRegistry
Priority-based failover for search and scrape providers. Auto-skips exhausted providers. Collects warnings across the pipeline.

| Provider | Type | Priority | Daily Limit |
|----------|------|----------|-------------|
| Tavily | Search | 1 | 33 |
| Brave | Search | 2 | 66 |
| DuckDuckGo | Search | 3 | Unlimited |
| Jina AI | Scrape | 1 | 200 |
| WebPeel | Scrape | 2 | 125 |
| Firecrawl | Scrape | 3 | 16 |
| Groq (Llama 3.3 70B) | LLM | 1 | 30 req/min |
| OpenRouter (Llama 3.2 3B) | LLM | 2 | 20 req/min |

### Credit Tracker
In-memory daily usage tracking for all 8 providers. Token + request limits. `DEV_MODE` bypasses all limits. Day-rolling usage log resets at midnight.

### Provider Status API
`GET /api/providers/status` — returns real-time usage stats and limits for all providers.

---

## Change Detection & Crawl Cache (all new)

- **CrawledUrl** model: SHA-256 content hashing per URL
- Configurable stale window (`CRAWL_STALE_HOURS`, default 24h)
- `checkCrawlCache()` — skip URLs scraped within the window
- `hashContent()` — detect unchanged pages, reuse cached events (no LLM call)
- `forceRefresh` parameter bypasses cache entirely

---

## Directory Scraper (all new)

Deterministic CSS-selector-based scraping for source sites with configured `SourceSiteConfig`:

- **Selectors:** Event container, name, dates, URL, venue, city
- **Pagination:** Query param or path segment, configurable start/max pages
- **Detail page following** with concurrency limit (3)
- **Fallback chain:** Jina AI → Firecrawl → AI extraction
- **Template replacement:** `{CITY}`, `{MONTH}`, `{YEAR}` in listing URLs
- Domain exclusion for dedicated scrapers

### Source Site Testing
- `POST /api/source-sites/[id]/test` — test a single site with saved or inline config. Returns preview events, page-by-page results, fallback usage.
- `POST /api/source-sites/test-all` — batch test all configured active sites. Pass/partial/fail per site.

---

## Real-Time Progress Streaming (all new)

- **progress-store.ts:** In-memory `Map<runId, string[]>` with 2000-message cap
- **`GET /api/ingest/progress/[runId]`** — returns live log entries
- **ProgressDialog component:** Polls every 1s, auto-scrolls, 5-minute timeout
- Used by Run Now, Run Search, and per-template Run buttons

---

## Multi-Contact System (expanded)

- **EventContact model:** `name`, `title`, `email`, `phone`, `isPrimary`, `sourceUrl`, `confidence`
- **ContactFinderModal:** View/edit/add/delete contacts per event. "Search for Contacts" triggers LLM extraction.
- **Contact finder pipeline:** 4-step extraction — own page → contact page search → organizer email/phone search → venue staff directory
- **Batch find-all:** `POST /api/events/find-all-contacts` processes up to 20 events
- **Primary auto-promotion:** On delete, next contact becomes primary. Legacy organizer fields stay in sync.
- **API routes:** Full CRUD at `/api/events/[id]/contacts` and `/api/events/[id]/contacts/[contactId]`

---

## Excel Import System (all new)

- `POST /api/events/import` — parse .xlsx via SheetJS, resolve locations by name, deduplicate, create events
- `GET /api/events/import/sample` — downloadable .xlsx template with example rows and column formatting
- Returns created/skipped/error counts with details

---

## Enhanced Data Model

| Addition | Details |
|----------|---------|
| **Location hierarchy** | `LocationType` enum (CITY/VENUE), self-referential `parentId` for City→Venue parent/child |
| **SearchTemplate.scope** | `TemplateScope` enum (CITY/VENUE/GLOBAL) — controls placeholder expansion |
| **SourceSite** | `sourceMode` (automated/manual), `scrapeMode` (auto/calendar/directory/search/ica/skip), `lastScrapeStatus`, `manualCheckFrequencyDays` |
| **SourceSiteConfig** | Full CSS selector config: 10+ selectors, pagination, detail page following, firecrawl/AI fallback toggles, test results |
| **CrawledUrl** | Change detection cache: `url` (PK), `contentHash`, `scrapedAt` |
| **Event extras** | `expectedAttendees`, `contactNote`, `sourceSiteId` FK |
| **IngestionRun.providersUsed** | JSON field tracking which providers were used per run |
| **5 new enums** | `LocationType`, `TemplateScope`, `SourceMode`, `ScrapeMode`, `ScrapeStatus` |

---

## Reusable UI Component Library (40+ new components)

### Analytics Suite
`MetricCard`, `MetricCardsGrid`, `AnalyticsChart`, `AnalyticsChartsGrid`, `AnalyticsFilterBar`, `InsightPanel`, `DrillDownList`

### Detail Page Suite
`DetailPage`, `DetailHeader`, `DetailSection`, `FieldItem`, `SummaryCard`, `ActivityTimeline`, `RelatedList`, `SidePanel`

### Form System
`UniversalForm`, `FormField`, `FormSection`, `FormFooter`, `WizardStepIndicator`, `FileUpload`

### List System
`UniversalList`, shared sub-components, column helpers

### Page Shell
`PageShell`, `PageShellHeader`, `Skeletons`, `RefreshBanner`, `EmptyState`, `ErrorState`

### Individual Components
`Checkbox`, `ProgressDialog`, `PhoneInput`, `AddressPicker`, `ColorPicker`, `Drawer`, `DropdownMenu`, `RadioGroup`, `Tabs`, `NavItem`, `Loader`, `ProviderCard`, `LogoUpload`, `Logo`, `Text`

---

## New API Routes (26 added — 41 total)

| Route | Purpose |
|-------|---------|
| `/api/ingest/infosec` | InfoSec Conferences scraper trigger |
| `/api/ingest/generic-llm` | Generic LLM scraping (single URL or full run) |
| `/api/ingest/progress/[runId]` | Live progress log polling |
| `/api/events/find-all-contacts` | Batch contact finder (up to 20 events) |
| `/api/events/[id]/contacts` | Multi-contact CRUD (list + add) |
| `/api/events/[id]/contacts/[contactId]` | Contact update/delete with primary promotion |
| `/api/events/import` | Excel import endpoint |
| `/api/events/import/sample` | Downloadable .xlsx template |
| `/api/source-sites` | Source site CRUD |
| `/api/source-sites/[id]` | Individual source site GET/PATCH/DELETE |
| `/api/source-sites/[id]/config` | SourceSiteConfig CRUD |
| `/api/source-sites/[id]/test` | Single site test endpoint |
| `/api/source-sites/test-all` | Batch test all configured sites |
| `/api/search-templates` + `[id]` | Search template CRUD |
| `/api/search-terms` + `[id]` | Search term CRUD |
| `/api/providers/status` | Provider usage stats |
| `/api/seed` | Seed 20 convention center locations |

---

## Infrastructure Additions

| Module | Purpose |
|--------|---------|
| `lib/ingest/build-queries.ts` | Template/term → concrete search query expansion with scope, date range, and templateId filtering |
| `lib/ingest/crawl-cache.ts` | SHA-256 content hashing and change detection |
| `lib/ingest/progress-store.ts` | In-memory progress log streaming |
| `lib/ingest/manual-scraper.ts` | Manual source site check tracking (14-day freshness) |
| `lib/scrape/llm-extractor.ts` | Dual-LLM extraction with truncated JSON salvage logic |
| `lib/scrape/directory-scraper.ts` | CSS selector-based deterministic scraping with AI fallback |
| `lib/run-scraper.ts` | Child process spawner for dedicated scraper scripts |
| `lib/contact-finder.ts` | 4-step LLM-based contact extraction pipeline |
| `lib/providers/*` | Full provider registry, credit tracker, 7 provider implementations |
| `lib/scrapers/dedicated-domains.ts` | Central domain exclusion registry |

---

## Files Added / Modified

| Category | Count | Key Paths |
|----------|-------|-----------|
| Scrapers | 14 files | `lib/scrapers/*` (14 scrapers + dedicated-domains registry) |
| Ingest modules | 5 files | `lib/ingest/{build-queries,search-pipeline,crawl-cache,progress-store,manual-scraper}.ts` |
| Provider system | 11 files | `lib/providers/{index,credit-tracker}.ts`, `lib/providers/search/*`, `lib/providers/scrape/*` |
| Scrape modules | 3 files | `lib/scrape/{llm-extractor,directory-scraper}.ts` |
| API routes | 41 files | `app/api/{ingest,events,locations,source-sites,search-templates,search-terms,providers,stats,runs,seed}/*` |
| Dashboard UI | 8 files | `components/dashboard/*` |
| Data management | 6 files | `components/{locations,templates,source-sites,directories,schedules}/*-manager.tsx` |
| UI library | 60+ files | `components/ui/{analytics,detail-page,form,list,page-shell}/*` + individual components |
| Types | 6 files | `types/components/*` |
| Scripts | 12 files | `scripts/ingest-*.ts` + test + seed scripts |
| Total | 140+ files | Full-stack application |
