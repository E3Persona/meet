import { spawn } from "child_process"
import { prisma } from "@/lib/prisma"
import { isSiteStale, getStaleHours } from "@/lib/ingest/crawl-cache"

const SCRAPER_KEYS: Record<string, string> = {
  "ingest-ica.ts": "ica",
  "ingest-cn.ts": "cn",
  "ingest-aca.ts": "aca",
  "ingest-tf.ts": "tf",
  "ingest-showsbee.ts": "showsbee",
  "ingest-eventseye.ts": "eventseye",
  "ingest-asae.ts": "asae",
  "ingest-blackmeetings.ts": "blackmeetings",
  "ingest-sgmp.ts": "sgmp",
  "ingest-thetradeshowcalendar.ts": "thetradeshowcalendar",
  "ingest-infosec.ts": "infosec",
}

export async function startScraperRun(
  scriptName: string,
  siteName: string,
  trigger: "manual" | "scheduled" = "manual",
  fast = false,
  dateFrom?: string,
  dateTo?: string,
  forceRefresh = false,
): Promise<{ runId: string; skipped?: boolean }> {
  // ── Change detection: skip if site was scraped recently ──
  if (!forceRefresh) {
    const site = await prisma.sourceSite.findFirst({ where: { name: siteName } })
    if (site) {
      const stale = await isSiteStale(site.id)
      if (!stale) {
        console.log(`[Scraper] Skipping "${siteName}" — scraped within ${getStaleHours()}h window`)
        return { runId: "", skipped: true }
      }
    }
  }

  const run = await prisma.ingestionRun.create({
    data: { trigger, status: "running" },
  })

  const site = await prisma.sourceSite.findFirst({ where: { name: siteName } })
  if (site) {
    await prisma.sourceSiteConfig.upsert({
      where: { sourceSiteId: site.id },
      update: {},
      create: { sourceSiteId: site.id },
    })
  }

  const scraperKey = SCRAPER_KEYS[scriptName]
  if (scraperKey) {
    await prisma.ingestConfig.upsert({
      where: { scraper: scraperKey },
      update: {},
      create: { scraper: scraperKey },
    })
  }

  const scriptPath = `${process.cwd()}/scripts/${scriptName}`
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL!,
    RUN_ID: run.id,
    ...(dateFrom ? { DATE_FROM: dateFrom } : {}),
    ...(dateTo ? { DATE_TO: dateTo } : {}),
    ...(forceRefresh ? { FORCE_REFRESH: "1" } : {}),
  }

  const child = spawn("npx", ["tsx", scriptPath], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  let stdout = ""

  child.stdout?.on("data", (chunk: Buffer) => {
    stdout += chunk.toString()
    process.stdout.write(`[${siteName}] ${chunk}`)
  })

  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[${siteName}] ${chunk}`)
  })

  child.on("error", (err) => {
    console.error(`[${siteName}] spawn error:`, err.message)
    prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), errorMessage: err.message },
    }).catch(() => {})
  })

  child.on("exit", (code) => {
    const lines = stdout.split("\n").filter((l) => l.includes("Complete:"))
    const match = lines[0]?.match(/(\d+) new from (\d+)/)
    const totalNew = match ? parseInt(match[1]) : 0
    const totalFound = match ? parseInt(match[2]) : 0

    if (code === 0) {
      prisma.ingestionRun.update({
        where: { id: run.id },
        data: { status: "success", finishedAt: new Date(), recordsFound: totalFound, recordsNew: totalNew },
      }).catch(() => {})
    } else {
      prisma.ingestionRun.update({
        where: { id: run.id },
        data: { status: "failed", finishedAt: new Date(), errorMessage: `Exited with code ${code}` },
      }).catch(() => {})
    }
  })

  return { runId: run.id }
}
