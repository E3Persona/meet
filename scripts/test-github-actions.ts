#!/usr/bin/env tsx
/**
 * Test script: verify GitHub Actions integration works end-to-end.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx pnpm exec tsx scripts/test-github-actions.ts
 *
 * What it does:
 *   1. Checks the GitHub token is valid
 *   2. Lists recent workflow runs for ingest.yml
 *   3. Triggers a test dispatch with the "aca" scraper (smallest/fastest)
 *   4. Polls for the new run to appear
 *
 * Environment variables:
 *   GITHUB_TOKEN  - GitHub Personal Access Token with "repo" scope
 *   GITHUB_OWNER  - (default: achiando)
 *   GITHUB_REPO   - (default: meeting-data)
 */

const GITHUB_OWNER = process.env.GITHUB_OWNER ?? "achiando"
const GITHUB_REPO = process.env.GITHUB_REPO ?? "meeting-data"
const GITHUB_TOKEN = process.env.GITHUB_TOKEN

async function main() {
  console.log("═══════════════════════════════════════════════════════")
  console.log("  GitHub Actions Integration Test")
  console.log("═══════════════════════════════════════════════════════\n")

  // ── Step 1: Validate token ──
  if (!GITHUB_TOKEN) {
    console.error("❌ GITHUB_TOKEN env var is required")
    console.error("\nHow to get one:")
    console.error("  1. Go to https://github.com/settings/tokens")
    console.error("  2. Click 'Generate new token (classic)'")
    console.error("  3. Name it 'meeting-da-ingest'")
    console.error("  4. Select scope: 'repo' (full control)")
    console.error("  5. Click 'Generate token' and copy it")
    console.error("  6. Run: GITHUB_TOKEN=ghp_xxx pnpm exec tsx scripts/test-github-actions.ts")
    process.exit(1)
  }

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }

  // ── Step 2: Verify token works ──
  console.log("Step 1: Verifying GitHub token...")
  const userRes = await fetch("https://api.github.com/user", { headers })
  if (!userRes.ok) {
    const text = await userRes.text()
    console.error(`❌ Token invalid (${userRes.status}): ${text}`)
    process.exit(1)
  }
  const user = await userRes.json() as { login: string }
  console.log(`✅ Authenticated as: ${user.login}\n`)

  // ── Step 3: Check workflow exists ──
  console.log("Step 2: Checking ingest.yml workflow exists...")
  const workflowRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ingest.yml`,
    { headers }
  )
  if (!workflowRes.ok) {
    console.error(`❌ ingest.yml not found (${workflowRes.status})`)
    console.error("   Make sure the workflow file is pushed to the 'main' branch")
    process.exit(1)
  }
  const workflow = await workflowRes.json() as { state: string; id: number }
  console.log(`✅ Workflow found (id: ${workflow.id}, state: ${workflow.state})\n`)

  // ── Step 4: List recent runs ──
  console.log("Step 3: Recent workflow runs:")
  const runsRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ingest.yml/runs?per_page=3`,
    { headers }
  )
  if (runsRes.ok) {
    const runs = await runsRes.json() as { workflow_runs: Array<{ id: number; status: string; conclusion: string | null; created_at: string; head_branch: string }> }
    for (const run of runs.workflow_runs ?? []) {
      console.log(`   - Run ${run.id}: ${run.status}/${run.conclusion ?? "pending"} (${run.created_at})`)
    }
    if (!runs.workflow_runs?.length) {
      console.log("   (no runs yet)")
    }
  }
  console.log()

  // ── Step 5: Trigger a test dispatch ──
  console.log("Step 4: Triggering test dispatch (aca scraper, no env vars)...")
  const dispatchRes = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ingest.yml/dispatches`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: "main",
        inputs: {
          scraper: "ingest-aca.ts",
          trigger: "manual",
        },
      }),
    }
  )

  if (dispatchRes.status === 204) {
    console.log("✅ Dispatch accepted (204 No Content)")
  } else {
    const text = await dispatchRes.text()
    console.error(`❌ Dispatch failed (${dispatchRes.status}): ${text}`)
    process.exit(1)
  }
  console.log()

  // ── Step 6: Poll for the new run ──
  console.log("Step 5: Polling for new run (max 30s)...")
  let found = false
  const startTime = Date.now()

  while (Date.now() - startTime < 30_000) {
    await new Promise((r) => setTimeout(r, 3000))

    const pollRes = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/actions/workflows/ingest.yml/runs?per_page=5`,
      { headers }
    )
    if (!pollRes.ok) continue

    const data = await pollRes.json() as { workflow_runs: Array<{ id: number; status: string; created_at: string; inputs?: Record<string, string> }> }
    const newRun = data.workflow_runs?.find(
      (r) => r.inputs?.scraper === "ingest-aca.ts" && r.created_at > new Date(Date.now() - 60_000).toISOString()
    )

    if (newRun) {
      console.log(`✅ New run found: ${newRun.id} (status: ${newRun.status})`)
      console.log(`   URL: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions/runs/${newRun.id}`)
      found = true
      break
    }
    process.stdout.write(".")
  }
  console.log()

  if (!found) {
    console.log("⚠️  No new run detected within 30s")
    console.log("   This is normal — GitHub may take a moment to queue it")
    console.log(`   Check manually: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/actions`)
  }

  console.log("\n═══════════════════════════════════════════════════════")
  console.log("  Test complete!")
  console.log("═══════════════════════════════════════════════════════")
  console.log("\n⚠️  NOTE: The workflow will fail if these GitHub secrets are not set:")
  console.log("   - DATABASE_URL")
  console.log("   - JINA_API_KEY (if using Jina scrapers)")
  console.log("   - Other API keys as needed by your scrapers")
  console.log("\n   Set them at: https://github.com/achiando/meeting-data/settings/secrets/actions")
}

main().catch((err) => {
  console.error("Fatal:", err)
  process.exit(1)
})
