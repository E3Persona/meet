# GitHub Actions Ingestion Setup

This document explains how to set up the GitHub Actions-based scraper pipeline
so that ingest scripts run on GitHub's servers (6h timeout) instead of Vercel
(serverless, 30s timeout).

## How it works

```
Dashboard "Run" button
  → POST /api/ingest/{scraper}  (Vercel, returns 202 instantly)
    → startScraperRun()          (creates IngestionRun row in DB)
      → triggerIngestWorkflow()  (POST to GitHub API)
        → GitHub Actions runs the scraper (up to 6h)
          → writes events to Neon DB
            → dashboard auto-refreshes, shows new events
```

## Setup steps

### 1. Create a GitHub Personal Access Token (PAT)

1. Go to https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. **Note**: `meeting-da-ingest`
4. **Expiration**: 90 days (or "No expiration" if you prefer)
5. **Select scopes**: check **`repo`** (Full control of private repositories)
6. Click **"Generate token"**
7. **Copy the token immediately** — it starts with `ghp_` and won't be shown again

### 2. Add the token to Vercel

1. Go to your Vercel project → **Settings** → **Environment Variables**
2. Add these variables:

| Variable | Value | Environment |
|----------|-------|-------------|
| `GITHUB_TOKEN` | `ghp_xxxxxxxxxxxx` | Production, Preview, Development |
| `GITHUB_OWNER` | `achiando` | All |
| `GITHUB_REPO` | `meeting-data` | All |

3. Redeploy your Vercel project for the env vars to take effect

### 3. Add secrets to GitHub

1. Go to https://github.com/achiando/meeting-data/settings/secrets/actions
2. Click **"New repository secret"** for each:

| Secret | Value | Notes |
|--------|-------|-------|
| `DATABASE_URL` | `postgresql://...` | Your Neon connection string (same as Vercel) |
| `GEMINI_API_KEY` | `AIza...` | Google AI Studio — used by generic-llm scraper |
| `GROQ_API_KEY` | `gsk_...` | https://console.groq.com — used by LLM extractors |
| `OPENROUTER_API_KEY` | `sk-or-...` | https://openrouter.ai — fallback for LLM extractors |
| `TAVILY_API_KEY` | `tvly-...` | https://tavily.com — search provider |
| `BRAVE_SEARCH_API_KEY` | `BSA...` | https://brave.com/search/api — search provider |
| `FIRECRAWL_API_KEY` | `fc-...` | https://firecrawl.dev — page scraping |
| `WEBPEEL_API_KEY` | varies | https://webpeel.dev — page scraping |

**Jina is free and needs no API key.**

### 4. Push the code

```bash
git push origin main
```

### 5. Test

```bash
# Test 1: Verify GitHub Actions workflow exists and can dispatch
GITHUB_TOKEN=ghp_xxx pnpm exec tsx scripts/test-github-actions.ts

# Test 2: Manual trigger from GitHub UI
# Go to https://github.com/achiando/meeting-data/actions/workflows/ingest.yml
# Click "Run workflow" → select "ingest-aca.ts" → Run workflow

# Test 3: Trigger from dashboard
# Go to your dashboard → Scrapers → click "Run" on any scraper
```

## Verification checklist

- [ ] GitHub PAT created with `repo` scope
- [ ] `GITHUB_TOKEN` added to Vercel env vars
- [ ] `GITHUB_OWNER` and `GITHUB_REPO` added to Vercel env vars
- [ ] `DATABASE_URL` added to GitHub Actions secrets
- [ ] API keys added to GitHub Actions secrets (see table above)
- [ ] Code pushed to `main` branch
- [ ] Test script passes: `GITHUB_TOKEN=ghp_xxx pnpm exec tsx scripts/test-github-actions.ts`
- [ ] Dashboard "Run" button triggers GitHub Actions (check Actions tab)

## Env vars reference (what each scraper uses)

| Scraper | Env vars needed |
|---------|----------------|
| ica, cn, aca, tf, showsbee, eventseye, asae, blackmeetings, sgmp, infosec, tradefairdates, eventsdc, gaylordnational, rrbitc, philadelphiaunion, phillyexpocenter, thetradeshowcalendar, eventbrite, eventbrite-api, webmobi, bigevent, marriott | `DATABASE_URL` only (Puppeteer-based, no API keys) |
| generic-llm | `DATABASE_URL`, `GEMINI_API_KEY` (or `SCRAPE_API_BASE_URL`) |
| search pipeline (via /api/ingest/run) | `DATABASE_URL`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `FIRECRAWL_API_KEY`, `WEBPEEL_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY` |

## Troubleshooting

### "GitHub Actions trigger failed (403)"
- Token doesn't have `repo` scope → regenerate with `repo` checked
- Token expired → create a new one

### "GitHub Actions trigger failed (404)"
- `GITHUB_OWNER` or `GITHUB_REPO` is wrong → check Vercel env vars
- Workflow file not on `main` branch → push to main

### Workflow runs but scraper fails
- Check GitHub Actions logs: https://github.com/achiando/meeting-data/actions
- Missing secrets → add them to GitHub repo secrets
- `DATABASE_URL` not set → the script can't connect to Neon

### Dashboard shows "running" but no events appear
- Check if the IngestionRun row updated in the DB
- GitHub Actions may still be queuing (30-60s delay is normal)
- Check Actions tab for the run status

### Cronjob.org triggers but nothing happens
- The old `cron.yml` workflow just called the Vercel API (same problem)
- Update cronjob.org to point to the new workflow, or
- Use GitHub's native cron schedule in `ingest.yml` (already configured)
