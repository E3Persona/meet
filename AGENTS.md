<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Event Pipeline Dashboard — Project Instructions

## What this app is

A dashboard to track meetings/conventions/tradeshows across venues, replacing
a manual Excel workflow. It manages locations, search keywords per location,
discovered events, and lets a human fill in organizer contact details.

## Stack

- Next.js 15, App Router, TypeScript
- Prisma + PostgreSQL (Supabase)
- SheetJS (`xlsx`) for Excel export

## UI rules — read this before writing any component

- **Never invent new UI components or design patterns.** All UI must come
  from the existing component library in `components/ui/`.
- Before building any screen, **look inside `components/ui/` first** and
  use what's already there: form components, list/table components, inputs,
  buttons, etc.
- If `components/ui/` has a form system (e.g. a `UniversalForm`-style
  wizard/form builder) — use it for the "Add Location" / "Add Search Term"
  / "Add Event" forms. Do not hand-roll a new form pattern.
- If `components/ui/` has an existing list/table component, use it for the
  Events table and Run History table. Do not pull in a new table library.
- If something is genuinely missing from `components/ui/` (e.g. no
  stat-card component exists), say so explicitly and ask before adding a
  new dependency or inventing a new component — don't silently create one
  that duplicates something close enough already in the library.
- No new design system, no Tailwind config changes, no new UI libraries
  (no shadcn/ui, no Material UI, etc.) unless `components/ui/` is missing
  something essential and the user explicitly approves adding it.

## Data model

Use this Prisma schema as the source of truth (adjust types only if the
existing project conventions require it — don't change field meaning):

- `Location` — name, address, city, state, sourceUrl, active
- `SearchTerm` — keyword, locationId (FK), active
- `Event` — locationId (FK), eventName, eventDateStart, eventDateEnd,
  sourceUrl, organizerName, organizerTitle, organizerEmail, organizerPhone,
  status ("new" | "reviewed" | "contacted"), dateAdded, runId (FK, nullable)
- `IngestionRun` — startedAt, finishedAt, trigger ("scheduled" | "manual"),
  status ("running" | "success" | "failed"), recordsFound, recordsNew,
  errorMessage

## Hard boundary — do not cross this

This app has an **automated half** (event discovery: name, venue, dates)
and a **manual-only half** (organizer contact info: name, title, phone,
email).

- The automated ingestion job may only populate `Event.eventName`,
  `eventDateStart/End`, `sourceUrl`, and `locationId`.
- `organizerName`, `organizerTitle`, `organizerEmail`, `organizerPhone`
  must **never** be set by the automated job. They are filled in only by a
  human, through the dashboard's inline-edit UI, after that person opens
  `sourceUrl` and reads the page themselves.
- Do not write, suggest, or wire up any code that scrapes a site's
  "Contact Us" or staff page and auto-extracts a name/phone/email. If asked
  to add this later, decline and explain why (bulk personal-data harvesting
  from third-party sites is out of scope for this project, regardless of
  framing).
- The ingestion job should use a licensed search API (Tavily, Serper.dev,
  or Brave Search API) for discovery, and Firecrawl (or similar,
  robots.txt-respecting) for page content — never scrape Google's results
  pages directly, and never scrape a site that disallows it.

## Ingestion job behavior

- One route, `/api/ingest/run`, handles both the scheduled cron trigger and
  the manual "Run now" button. Same code path, different `trigger` value
  logged on the `IngestionRun` row.
- Every run — scheduled or manual — must write exactly one `IngestionRun`
  row with real counts, not estimates.
- Dedupe new events against existing ones by `eventName` + `locationId` +
  `eventDateStart` before inserting.

## Export

- Excel export must mirror the original spreadsheet column order: Event
  Name, Location, Contact Name, Contact Title, Phone, Email, Date of Event,
  Status.
- Events list (in UI and export) is always sorted chronologically by
  `eventDateStart`. This is a hard requirement, not a default that can
  silently change.

## What "done" looks like for a first pass

1. Locations + search terms manager (CRUD, using `components/ui/` forms/lists)
2. Events table: filter, sort (chronological), inline-edit organizer fields,
   status dropdown, Excel export button
3. Stats row: total locations, total events, new events this week, last run
   status — all computed from real DB rows, never hardcoded
4. Run history table showing every `IngestionRun`
5. "Run now" button wired to `/api/ingest/run`
6. Cron wiring (Vercel Cron, or note for Coolify cron container if
   self-hosting) calling the same route on a schedule
