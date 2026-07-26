# Event Pipeline Dashboard — Session Summary

## Goal
Build a meeting/convention/tradeshow event discovery dashboard replacing Excel. All custom scrapers (ICA, ConferenceNext, AllConferenceAlert, TradeFest) now use local `puppeteer-core` instead of Brightdata WS, run via standalone `tsx` scripts spawned as subprocesses by API routes.

## What's Built

### Custom Scrapers — All Migrated to Local Chrome
All four custom scrapers now share the same architecture:
- **Local `puppeteer-core`** → `/usr/bin/google-chrome` with `--no-sandbox`, no Brightdata WS needed
- **Standalone ingestion script** (`scripts/ingest-{scraper}.ts`) — loads active locations, calls scraper, saves to Event table with dedup by `eventName` + `locationId` + `eventDateStart`
- **Dedicated API route** (`app/api/ingest/{scraper}/route.ts`) — `POST` triggers the script via `execSync("npx tsx ...")`, creates `IngestionRun` row
- **Wired `runId`** through env var to associate saved events with the run

| Scraper | File | Source Site | City Mapping | Detail Pages |
|---|---|---|---|---|
| ICA | `lib/scrapers/ica.ts` | `internationalconferencealerts.com` | `cityToIcaSlug()` — maps city/state to ICA URL slug with regional fallbacks | Yes: email via mailto/data-cfemail, venue, committee |
| CN | `lib/scrapers/conferencenext.ts` | `conferencenext.com` | `cityToCnSlug()` — reverse lookup from `TARGET_CITY_SLUGS` (17 cities) | Yes: organizerName, org, email, officialWebsite |
| ACA | `lib/scrapers/allconferencealert.ts` | `allconferencealert.net` | Country mode scrapes all US, matches by venue city | Yes: contactPerson, organizedBy, inquiryEmail, objective |
| TF | `lib/scrapers/tradefest.io` | `tradefest.io` | Scrapes ranked list, matches by venue city | Yes: organizerName, expectedAttendees/Exhibitors |

### Retry wrapper on `page.goto`
All three scrapers now have `withRetry()` (3 attempts, 3s backoff) around `page.goto` to handle intermittent "Navigating frame was detached" errors from Next.js RSC navigation.

### Directory Config Scraping System (unchanged)
- Prisma `SourceSiteConfig` + CRUD + test endpoints
- `lib/scrape/directory-scraper.ts` — fetch + cheerio with Firecrawl/LLM fallback
- `lib/scrape/llm-extractor.ts` — OpenRouter extraction via `gemini-2.5-flash`
- `components/directories/directories-manager.tsx` — full config UI

### Dashboard Scrapers Panel
- New sidebar section "Scrapers" with `Bot` icon lists all 4 custom scrapers as cards
- Each card has a "Run Now" button that calls the scraper's API route
- On success, the API route auto-creates a `SourceSiteConfig` for that site via `upsert`, marking it as "configured" in the Directories view
- Uses the existing `Button` component with `loading` state + CSS spinner

## Key Decisions
- **All scrapers run outside Next.js bundler** — `puppeteer-core` via `tsx` child process avoids Turbopack's module transformation (which breaks `puppeteer-extra` stealth plugin and some native Node.js module patterns)
- **No stealth plugin** — plain `puppeteer-core` works for all four target sites (Cloudflare on ICA and ACA is bypassed by full Chrome, not by stealth)
- **Standalone ingestion scripts** — each scraper has its own script that loads locations from DB, maps city→slug, scrapes, deduplicates, and saves. Scripts accept `DATABASE_URL` and `RUN_ID` env vars
- **Detail pages enabled** — scrapers extract organizer contact info (name, email, org) from event detail pages on the directory site itself (not from the organizer's own "Contact Us" page)
- **2s delay between detail pages** — prevents rate limiting during batch detail scraping
- **City-specific vs country-wide** — ICA and CN scrape per-city pages (faster, targeted); ACA and TF scrape a single US-wide listing then match by venue city
- **`ica` ScrapeMode enum** — marks ICA's source site so main ingestion route filters it out

## Next Steps
1. Test full runs from the dashboard UI (Scrapers section → Run Now buttons)
2. Add cron schedule calling each scraper API route
3. Add `run.ingestionLog` entries for per-site visibility within a run
4. Optimize delay timing if rate limits allow faster detail page scraping

## Relevant Files
- `lib/scrapers/ica.ts` — ICA scraper (`puppeteer-core`, card+detail extraction, `cityToIcaSlug()`)
- `lib/scrapers/conferencenext.ts` — CN scraper, `cityToCnSlug()` export, `TARGET_CITY_SLUGS`
- `lib/scrapers/allconferencealert.ts` — ACA scraper, "Load More" pattern, country/city modes
- `lib/scrapers/tradefest.ts` — TF scraper, ranked list extraction, Chakra UI CSS selectors
- `scripts/ingest-ica.ts` — Standalone ICA ingestion (detup, DB save)
- `scripts/ingest-cn.ts` — Standalone CN ingestion
- `scripts/ingest-aca.ts` — Standalone ACA ingestion
- `scripts/ingest-tf.ts` — Standalone TF ingestion
- `app/api/ingest/ica/route.ts` — ICA API endpoint
- `app/api/ingest/cn/route.ts` — CN API endpoint
- `app/api/ingest/aca/route.ts` — ACA API endpoint
- `app/api/ingest/tf/route.ts` — TF API endpoint
- `app/api/ingest/run/route.ts` — Main ingestion route (filters out `ica`-mode sites)
- `lib/scrape/directory-scraper.ts` — Fetch/cheerio/Firecrawl/LLM scraper
- `lib/scrape/llm-extractor.ts` — LLM extraction helper
- `app/api/source-sites/[id]/config/route.ts` — Config CRUD
- `app/api/source-sites/[id]/test/route.ts` — Inline config test endpoint
- `app/api/source-sites/test-all/route.ts` — Batch test all
- `components/directories/directories-manager.tsx` — Directories config UI
- `components/dashboard/scrapers-panel.tsx` — Scrapers dashboard panel (4 scraper cards with Run buttons)
- `app/api/ingest/ica/route.ts` — ICA API endpoint (auto-configures on success)
- `app/api/ingest/cn/route.ts` — CN API endpoint (auto-configures on success)
- `app/api/ingest/aca/route.ts` — ACA API endpoint (auto-configures on success)
- `app/api/ingest/tf/route.ts` — TF API endpoint (auto-configures on success)


https://script.google.com/macros/s/AKfycbz0LuZoB3yZCXzhMWg1iSp8vxcWokOgAjXJ-G-3-S687pTrvpV-62YfO7iaT0kYniQn/exec

meeting-data-sheet@glossy-waters-502807-b6.iam.gserviceaccount.com-email-service-account

curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent" \
  -H 'Content-Type: application/json' \
  -H 'X-goog-api-key: AIzaSyD86yO2_I2CoKTUJVNrPwxxW2Mp8Y6JIGs' \
  -X POST \
  -d '{
    "contents": [
      {
        "parts": [
          {
            "text": "Explain how AI works in a few words"
          }
        ]
      }
    ]
  }'


https://www.eventbrite.com/api/v3/destination/events/?event_ids=115577717063,127257012149",130323899291,141503740497,143005871411,313979339657,621121801027,856508378617,1225418592999,1268113304029,1307032201499,1328573803009,1345495115109,1364768642749,1390856763019&page_size=100&expand=event_sales_status,image,primary_venue,saves,ticket_availability,primary_organizer,primary_organizer.image,public_collections