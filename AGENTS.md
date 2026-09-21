<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Event Pipeline Dashboard — Project Instructions

## What this app is

A dashboard to track meetings/conventions/tradeshows across venues, replacing a
manual Excel workflow. It manages locations (hierarchical), search templates and
literal search terms, discovered events, and lets a human fill in organizer
contact details.

## Stack

- Next.js 16.2.6, App Router, TypeScript 5, React 19
- Prisma 7 + PostgreSQL (Neon), `PrismaClient` with `@prisma/adapter-pg`
- SheetJS (`xlsx`) for Excel export
- **Package manager: pnpm** (`pnpm-workspace.yaml`, `.npmrc` with `onlyBuiltDependencies`)
- UI: `@/components/ui/` (shadcn-style), `@tanstack/react-table`, `lucide-react`, `sonner` toasts, `tailwindcss` v4

## Commands (use pnpm)

```
pnpm dev              # http://localhost:3000
pnpm build            # runs `prisma generate && next build`
pnpm lint             # eslint
pnpm typecheck        # tsc --noEmit — run before committing TS changes
pnpm format           # prettier --write "**/*.{ts,tsx}"
pnpm db:push          # prisma db push — direct schema-to-DB sync
pnpm db:migrate       # prisma migrate deploy (production)
pnpm db:seed          # pnpm exec tsx prisma/seed.ts
```

Individual scraper CLI scripts (also in `package.json` scripts):
`pnpm ingest:aca`, `pnpm ingest:asae`, `pnpm ingest:bm`.  
Full list in `scripts/` — these are triggered remotely via GitHub Actions
(`.github/workflows/ingest.yml`) and also spawn as edge API routes
(`/api/ingest/<scraper>/route.ts`).

## UI rules — read before writing any component

- **Never invent new UI components or design patterns.** All UI must come from
  `@/components/ui/`. See `components/ui/index.ts` for the barrel export.
- For forms: use `UniversalForm` from `@/components/ui/form/universal-form` with
  `FormSection[]` from `@/types/components`. See `lib/constants/form.ts`.
- For lists: use `UniversalList` from `@/components/ui/list/universallist`.
- For async run status: use `ProgressDialog` from `@/components/ui/progress-dialog`.
- If `components/ui/` is missing something essential, say so and ask before adding
  a new dependency or inventing a component.

## Prisma client & generated code

- Prisma client import: `import { prisma } from "@/lib/prisma"` (singleton with
  `withRetry` wrapper that retries P1017 connection-drop errors). Also re-exports
  `withRetry`.
- Raw generated types: `@/lib/generated/prisma/client`, `@/lib/generated/prisma/models/*`
  (includes `WebSearchQuery.ts`, `SearchTemplate.ts`, etc.).
- **`lib/generated/prisma/` is auto-generated — DO NOT EDIT.** Regenerate with
  `pnpm exec prisma generate` (or `pnpm build`, which runs it first).
- Schema source of truth: `prisma/schema.prisma` (Prisma 7 syntax).
- Enum values map to TypeScript types in `@/lib/generated/prisma/enums.ts`.

## Locations hierarchy

```
STATE → DISTRICT (optional) → CITY → VENUE
```

- `Location` has `type` (LocationType enum), `parentId` (self-relation, nullable
  for STATE), `city`/`state` (denormalized for filtering), `venueType`,
  `lastIngestedAt`.
- City uses `city` field for its name and `state` for state code.
- Venues have `parentId` → their city Location.
- Seed: `prisma/seed.ts` reads `prisma/locations_seed.json` (15 MB, large file).
  Run: `pnpm db:seed` or `pnpm exec tsx prisma/seed.ts`.
- Per-city / per-venue seed scripts: `prisma/db:seed:philly`, `db:seed:baltimore`,
  `db:seed:hotels`.
- API: `GET /api/locations` returns all with `type`, `city`, `state`, `active`.

## Search system (two-tier: templates + literal terms)

This is the core of how search queries are generated.

### Tier 1 — SearchTemplate (placeholder-driven)

- `SearchTemplate` model: `template` (string with placeholders), `scope`
  (`CITY | VENUE | GLOBAL`), `active` boolean.
- Placeholders: `{CITY}`, `{VENUE}`, `{MONTH}`, `{YEAR}`.
- Scope determines which locations the template expands against:
  - **CITY** — resolved once per active CITY location (uses `city.city ?? city.name`).
  - **VENUE** — resolved once per active VENUE location (uses `venue.name`).
  - **GLOBAL** — runs once as-is, no expansion.
- Managed in UI: `components/templates/templates-manager.tsx` (uses `UniversalForm`
  + `UniversalList`). API: `/api/search-templates` (GET list, POST create),
  `/api/search-templates/[id]` (PATCH/PATCH for active, DELETE).

### Tier 2 — SearchTerm (literal keyword)

- `SearchTerm` model: `keyword` (string), `locationId` (nullable — null =
  global keyword), `active` boolean.
- Two behaviors in `buildSearchQueries`:
  - **Global terms** (`locationId === null`) are prefixed with `${monthLabel} `
    and suffixed with ` ${city.city ?? city.name}` — run once per active city.
  - **Pinned terms** (`locationId` set) are run only for that specific venue,
    using the venue's city name in the query.

### How queries are built — `lib/ingest/build-queries.ts`

`buildSearchQueries(opts)` returns `SearchQuery[]` (from `lib/ingest/search-pipeline.ts`):

```ts
interface SearchQuery {
  locationId: string | null
  locationName: string
  query: string
  monthLabel: string
}
```

Flow:
1. Load active templates (optionally filtered by `templateIds`).
2. Load active search terms: global (`locationId === null`) and pinned
   (`locationId !== null`, bucketed into a `Map` by location).
3. Load active CITY and VENUE locations (optionally filtered by `locationIds`).
   If venue IDs are passed but their parent cities aren't loaded yet, the
   function fetches missing city parents (so CITY-scoped templates can expand).
4. Determine month range: default `startMonth=0`, `endMonth=5` (6 months).
   If `dateFrom`/`dateTo` provided, compute month offsets from `now`.
5. For each month × each template × each matching location, expand placeholders
   and push a `SearchQuery`.
6. For each month × each global term × each city, push a query
   `${monthLabel} ${keyword} ${city}`.
7. For each month × each pinned term × each matching venue, push a query
   `${monthLabel} ${keyword} ${venue.city ?? venue.name}`.
8. Optionally cap at `maxQueries` (sliced from the front).

### How queries run — `lib/ingest/search-pipeline.ts`

1. `buildRegistry()` creates a `ProviderRegistry` with search providers
   (Tavily → Brave → DuckDuckGo by priority) and scrape providers
   (Jina → WebPeel → Firecrawl). Each provider is enabled only if its env var
   is set (DDG and Jina are always on).
2. `runSearches()` runs each SearchQuery against the registry (concurrency-
   limited). Results de-duplicated by URL. Excluded domains filtered out
   (see `lib/scrapers/dedicated-domains.ts`).
3. For locations with zero hits, `buildFallbackQueries()` tries known
   SourceSites with `scrapeMode: calendar | directory` using `site:{domain}`.
4. `runScrapes()` processes each hit URL:
   - **Crawl cache** (`lib/ingest/crawl-cache.ts`): checks if URL was crawled
     within `CRAWL_STALE_HOURS` (default 24). If fresh and content hash
     unchanged, skips LLM extraction and reuses cached events.
   - **Scrape**: fetch markdown via scrape provider.
   - **Extract**: `extractEventsWithLLM()` parses events from markdown.
   - **Dedupe**: `isDuplicate()` checks by `eventName` + `locationId` +
     `eventDateStart` (case-insensitive). Also checks cross-location if date set.
   - **Save**: creates an `Event` with ONLY `eventName`, `eventDateStart`,
     `eventDateEnd`, `sourceUrl`, `locationId`, `runId`. No organizer fields.

### Web search history — `WebSearchQuery` / `WebSearchResult`

These models (`lib/generated/prisma/models/WebSearchQuery.ts`,
`WebSearchResult.ts`) are for the **manual web-search UI**, not the ingestion
pipeline. They persist ad-hoc searches performed in `app/web-search/page.tsx`.

- `WebSearchQuery`: `id`, `query` (string), `createdAt` (autotimestamp),
  `results` (1:N to `WebSearchResult`).
- `WebSearchResult`: `id`, `queryId` (FK), `source` ("google" | "duckduckgo"),
  `title`, `url`, `snippet`, `publishedDate` (parsed from result text), `page`,
  `createdAt`.
- API: `app/api/web-search/route.ts`:
  - `POST` with `{ query, maxPages? }` → single manual search (DuckDuckGo via
    `duck-duck-scrape` library + Google via `google-sr` library, in parallel).
  - `POST` with `{ locationIds?, templateIds?, dateFrom?, dateTo? }` →
    template-based search using `buildSearchQueries` (capped at 20 queries,
    or unlimited in `DEV_MODE`), both DDG + Google in parallel per query with
    concurrency-limited batch processing (5 concurrent in prod, 10 in DEV_MODE).
  - Each POST creates an `IngestionRun` row (`trigger: "manual"`) that tracks
    `recordsFound`, `recordsNew`, `providersUsed`, and progress logs
    (pollable via `/api/ingest/progress/[runId]`). The response includes
    `runId` so the client can track the run.
  - `GET` → fetches last 20 `WebSearchQuery` with included results (for the
    history sidebar in the web-search UI).
- Unlike ingestion events, web-search results are not deduped across
  `WebSearchQuery` rows — each search creates a new query row.
- Web-search does **not** use the `ProviderRegistry` (no Tavily); it calls
  `duck-duck-scrape` and `google-sr` providers directly with
  `Promise.allSettled` for parallel fallback.

## Ingestion pipeline

### Central route — `app/api/ingest/run/route.ts`

- **GET** (cron entry point): requires bearer token matching
  `GOOGLE_SHEETS_SYNC_API_KEY` env var. Creates a parent `IngestionRun` with
  `trigger: "scheduled"`, then fan-outs to 22 dedicated scraper routes in
  batches of 3 (`/api/ingest/<scraper>`), then calls `runIngest("scheduled",
  { scraperTypes: ["search", "cp", "venues"] })`.
- **POST** (manual or scheduled): `?trigger=scheduled` query param sets the
  trigger type; defaults to "manual". Body accepts `RunConfig`:
  `{ scraperTypes, locationIds, templateIds, maxQueries, dateFrom, dateTo,
  sourceSiteId, forceRefresh, clientRunId }`.
- Each scraper route (`/api/ingest/<scraper>/route.ts`) spawns a `tsx scripts/ingest-*.ts`
  subprocess (e.g. `scripts/ingest-ica.ts`). These are dedicated site scrapers
  (ICA, ASAE, ConventionPlanit, etc.) — separate from the general search pipeline.
- Dedicated scraper scripts run via GitHub Actions on a **4-week rotation**
  (`.github/workflows/cron-week-1..4.yml`), each calling the cached reusable
  runner (`.github/workflows/scrape.yml`). One scraper per week, so the whole
  set covers a month instead of all 23 every week.

### `runIngest()` flow

1. Create `IngestionRun` row with `status: "running"`, `trigger`.
2. If `sourceSiteId` given: single-site scrape, update run, return early.
3. Run `runManualSourceChecks()` — records manual source checks (14-day freshness
   window, `MANUAL_FRESHNESS_DAYS = 14`).
4. Determine location IDs (all active, or from body).
5. **Frequency filter** (scheduled runs only, not DEV_MODE): checks
   `IngestionSchedule` named `"default-frequency-tracker"`. Limits 2 runs per
   location per 30 days. Manual runs skip this entirely.
6. Build search queries via `buildSearchQueries()`.
7. For each scraperType in body:
   - `"search"` → `runSearchScraper()`.
   - `"cp"` → `scrapeConventionPlanit()` (creates/updates VENUE locations).
   - `"venues"` → spawns `jobs/scrapeListing.ts` subprocess.
8. Update `lastIngestedAt` on processed locations.
9. Update `IngestionRun` row: `status: "success" | "failed"`, `finishedAt`,
   `recordsFound`, `recordsNew`, `providersUsed`.

### DEV_MODE

`process.env.DEV_MODE === "1" || process.env.DEV_MODE === "true"` — when set:
- Search concurrency boosted (10 vs 5 scheduled, 8 vs 3 scrape).
- No `maxQueries` cap on `buildSearchQueries`.
- Frequency filter is skipped (manual-style behavior).
- All provider limits bypassed in `canUseProvider()`.

## Hard boundary — do not cross

- **Automated** may populate: `Event.eventName`, `eventDateStart`,
  `eventDateEnd`, `sourceUrl`, `locationId`, `runId` only.
- `organizerName`, `organizerTitle`, `organizerEmail`, `organizerPhone` must
  **never** be set by ingestion. Filled only by humans via the events table
  inline-edit UI, after reading `sourceUrl` themselves.
- **Do not write** code that scrapes "Contact Us" / staff pages for
  name/phone/email. If asked, decline — bulk personal-data harvesting from
  third-party sites is out of scope.
- Ingestion uses licensed search APIs (Tavily/Brave/DuckDuckGo) + Firecrawl/Jina
  for scraping. Never scrape Google results pages or robots-disallowed sites.

## Event dedupe (hard requirement)

- `isDuplicate()` checks `eventName` (case-insensitive) + `locationId` +
  `eventDateStart`. Also cross-location on name+date.
- DB-level: `@@unique([locationId, eventName, eventDateStart])` on `Event`.

## Export (hard requirement)

- Column order must be: Event Name, Location, Contact Name, Contact Title,
  Phone, Email, Date of Event, Status.
- Events always sorted chronologically by `eventDateStart`.
- Export endpoint: `app/api/events/export/route.ts`.

## Important env vars

```
DATABASE_URL           — PostgreSQL (Neon)
TAVILY_API_KEY         — primary search provider
BRAVE_SEARCH_API_KEY   — fallback search
FIRECRAWL_API_KEY      — primary scraper
WEBPEEL_API_KEY        — fallback scraper
GEMINI_API_KEY         — LLM extraction / venue scraping
GROQ_API_KEY / OPENROUTER_API_KEY — LLM extraction
JINA_API_KEY / LOCAL_SCRAPER_URL  — alternative scraper
GOOGLE_SHEETS_SYNC_API_KEY — auth for cron GET /api/ingest/run
CRAWL_STALE_HOURS      — change-detection window (default 24)
DEV_MODE               — set "1" to bypass all limits
NEXT_PUBLIC_APP_URL    — used for internal route fan-out in cron
```

## Progress tracking

Ingestion progress is stored in an in-memory `Map` (`lib/ingest/progress-store.ts`)
during a run. Client polls `/api/ingest/progress/[runId]/route.ts` to get
messages. **This does not survive a serverless instance restart** — if the
Next.js server is cold-restarted mid-run, progress is lost (but the
`IngestionRun` row persists in the DB).

## File layout (key dirs)

```
app/                        Next.js App Router
  api/                      API routes (ingest, events, locations, search-templates, web-search)
  locations/page.tsx        Locations manager page
  page.tsx                  Main dashboard (events, locations, templates, sources, etc.)
  web-search/page.tsx       Manual web search + history UI
components/
  ui/                       Shared component library (DO NOT duplicate)
  dashboard/                EventsTable, RunNowButton, RunHistoryTable, StatsRow, Sidebar
  templates/                TemplatesManager (SearchTemplate CRUD + run)
  locations/                LocationsManager (hierarchical location CRUD)
  source-sites/             SourceSitesManager
  directories/              DirectoriesManager, VenueDirectoriesManager
lib/
  prisma.ts                 Prisma singleton + withRetry
  generated/prisma/         AUTO-GENERATED — do not edit
  ingest/                   build-queries.ts, search-pipeline.ts, crawl-cache.ts, manual-scraper.ts
  providers/                Search/scrape provider registry + credit tracking
  scrape/                   LLM event extraction, selectors, sitemap
  scrapers/                 Dedicated site scrapers (conventionplanit, dedicated-domains)
scripts/                    Standalone tsx ingest scripts (run locally or via GH Actions)
jobs/                       Venue directory scraping (Puppeteer-based)
prisma/                     schema.prisma, seed scripts, JSON seeds
```
