const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "achiando"
const GITHUB_REPO = process.env.GITHUB_REPO ?? "meeting-data"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

const SCRAPER_TO_WORKFLOW: Record<string, string> = {
  "ingest-aca.ts": "ingest-aca.ts",
  "ingest-asae.ts": "ingest-asae.ts",
  "ingest-bigevent.ts": "ingest-bigevent.ts",
  "ingest-blackmeetings.ts": "ingest-blackmeetings.ts",
  "ingest-cn.ts": "ingest-cn.ts",
  "ingest-eventbrite.ts": "ingest-eventbrite.ts",
  "ingest-eventbrite-api.ts": "ingest-eventbrite-api.ts",
  "ingest-eventsdc.ts": "ingest-eventsdc.ts",
  "ingest-eventseye.ts": "ingest-eventseye.ts",
  "ingest-gaylordnational.ts": "ingest-gaylordnational.ts",
  "ingest-generic-llm.ts": "ingest-generic-llm.ts",
  "ingest-ica.ts": "ingest-ica.ts",
  "ingest-infosec.ts": "ingest-infosec.ts",
  "ingest-marriott.ts": "ingest-marriott.ts",
  "ingest-philadelphiaunion.ts": "ingest-philadelphiaunion.ts",
  "ingest-phillyexpocenter.ts": "ingest-phillyexpocenter.ts",
  "ingest-rrbitc.ts": "ingest-rrbitc.ts",
  "ingest-sgmp.ts": "ingest-sgmp.ts",
  "ingest-showsbee.ts": "ingest-showsbee.ts",
  "ingest-tf.ts": "ingest-tf.ts",
  "ingest-thetradeshowcalendar.ts": "ingest-thetradeshowcalendar.ts",
  "ingest-tradefairdates.ts": "ingest-tradefairdates.ts",
  "ingest-webmobi.ts": "ingest-webmobi.ts",
}

export interface TriggerOptions {
  scraperScript: string
  trigger?: "manual" | "scheduled"
  dateFrom?: string
  dateTo?: string
  forceRefresh?: boolean
}

export async function triggerIngestWorkflow(options: TriggerOptions): Promise<{
  workflowRunId: number
  workflowRunUrl: string
}> {
  if (!GITHUB_TOKEN) {
    throw new Error("GITHUB_TOKEN env var is required for GitHub Actions triggers")
  }

  const scraperFile = SCRAPER_TO_WORKFLOW[options.scraperScript]
  if (!scraperFile) {
    throw new Error(`Unknown scraper script: ${options.scraperScript}`)
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ingest.yml/dispatches`

  const body: Record<string, unknown> = {
    ref: "main",
    inputs: {
      scraper: scraperFile,
      trigger: options.trigger ?? "manual",
      ...(options.dateFrom && { date_from: options.dateFrom }),
      ...(options.dateTo && { date_to: options.dateTo }),
      ...(options.forceRefresh && { force_refresh: "true" }),
    },
  }

  console.log(`[GitHub Actions] Triggering workflow for ${scraperFile}`)

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify(body),
  })

  if (!res.ok && res.status !== 204) {
    const text = await res.text()
    throw new Error(`GitHub Actions trigger failed (${res.status}): ${text}`)
  }

  // The dispatch endpoint returns 204 with no body.
  // Poll for the most recent run of this workflow to get the run URL.
  const runUrl = await pollForRunUrl(scraperFile)

  return {
    workflowRunId: 0,
    workflowRunUrl: runUrl,
  }
}

async function pollForRunUrl(scraperFile: string, maxAttempts = 10): Promise<string> {
  const listUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ingest.yml/runs?per_page=5`

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000))

    const res = await fetch(listUrl, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    })

    if (!res.ok) continue

    const data = await res.json() as { workflow_runs: Array<{ id: number; html_url: string; created_at: string; inputs?: Record<string, string> }> }
    const run = data.workflow_runs?.find(
      (r) => r.inputs?.scraper === scraperFile && r.created_at > new Date(Date.now() - 30_000).toISOString()
    )

    if (run) return run.html_url
  }

  return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions`
}
