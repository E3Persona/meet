# e3 Event Intelligence Dashboard

Sales pipeline for tracking meetings, conventions, and tradeshows across venues.

## Stack

- Next.js 15, App Router, TypeScript
- Prisma + PostgreSQL (Supabase/Neon)
- SheetJS (`xlsx`) for Excel export

## Cron Job

The ingestion pipeline runs via a scheduled HTTP request to:

```
POST /api/ingest/run?trigger=scheduled
```

Set this up with any cron service that can hit HTTP endpoints:

### cron-job.org (recommended)

1. Go to [cron-job.org](https://cron-job.org)
2. Create a new cron job:
   - **URL**: `https://your-domain.com/api/ingest/run?trigger=scheduled`
   - **Method**: `POST`
   - **Schedule**: Every day at 6:00 (`0 6 * * *`)
   - **Request body**: `{}`
   - **Content-Type**: `application/json`

### GitHub Actions

```yaml
# .github/workflows/ingest.yml
name: Daily Ingestion
on:
  schedule:
    - cron: "0 6 * * *"
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST https://your-domain.com/api/ingest/run?trigger=scheduled
```

### Manual run

Use the **Run Search** button in the dashboard or the **Run Now** button on any schedule in the Schedules tab.

## Change Detection

The pipeline caches scraped URLs to avoid re-scraping unchanged pages:

- **Staleness window**: 24 hours (configurable via `CRAWL_STALE_HOURS` env var)
- **Content hash**: SHA-256 of scraped markdown — if content hasn't changed, LLM extraction is skipped
- **Force refresh**: Check the "Force refresh" box on Run Search to bypass the cache

First run after deploy populates the cache. Subsequent runs skip recently-scraped URLs.

## Provider Credit Tracking

Each API provider has daily request/token limits tracked in-memory:

| Provider   | Default Daily Limit    | Env Override                                              |
| ---------- | ---------------------- | --------------------------------------------------------- |
| Tavily     | 33 requests            | `TAVILY_DAILY_LIMIT`                                      |
| Brave      | 66 requests            | `BRAVE_DAILY_LIMIT`                                       |
| DuckDuckGo | unlimited              | —                                                         |
| Jina       | 200 requests           | `JINA_DAILY_LIMIT`                                        |
| WebPeel    | 125 requests           | `WEBPEEL_DAILY_LIMIT`                                     |
| Firecrawl  | 16 requests            | `FIRECRAWL_DAILY_LIMIT`                                   |
| Groq       | 1000 req / 100k tokens | `GROQ_DAILY_LIMIT` / `GROQ_DAILY_TOKEN_LIMIT`             |
| OpenRouter | 200 req / 500k tokens  | `OPENROUTER_DAILY_LIMIT` / `OPENROUTER_DAILY_TOKEN_LIMIT` |

Set `DEV_MODE=1` to remove all artificial limits (no batching, no max queries, no frequency filter).

## Important Boundaries

- **Automated**: event name, venue, dates, source URL — populated by the ingestion job
- **Manual only**: organizer name, title, phone, email — filled in by humans through the inline-edit UI
- No scraping of "Contact Us" or staff pages for bulk personal-data extraction

## Environment Variables

See `.env.example` for required vars. Key ones:

- `DATABASE_URL` — PostgreSQL connection string
- `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` — provider keys
- `CRAWL_STALE_HOURS` — change detection window (default 24)
- `DEV_MODE` — set to `1` for unlimited dev mode

Subdirectory URL: e3ei.e3personnel.com
Subdomain Name; e3evint
e3evint.e3personnel.com

The test script is doing its job — it exposes exactly where things break. You can run:

# See all due sources

npx tsx scripts/test-listing-scrape.ts --show-sources

# Test a specific source

npx tsx scripts/test-listing-scrape.ts --venue-id=<full-id>

# Test any URL directly

npx tsx scripts/test-listing-scrape.ts --url=https://www.paconvention.com/events

# With date filter

npx tsx scripts/test-listing-scrape.ts --url=https://example.com/events --date-from=2025-07-01
You now have full visibility into Jina → blocks → LLM at each step. Want me to look at why the block s

*NET MINISTRIES TRUST* 
Meeting with Tijwa Limited

 *©9PM - 9:40PM📍* 
 https://us06web.zoom.us/j/86318491769?pwd=0hpdMEAbMe0Itvi6v1qyu9Gfc5bpYG.1