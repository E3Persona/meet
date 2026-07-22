import { prisma } from "@/lib/prisma"
import { createJinaProvider } from "../lib/providers/scrape/jina"

const jina = createJinaProvider()

const GOLD_TIER_PATTERNS = [
  { path: "/events", label: "events calendar" },
  { path: "/calendar", label: "calendar page" },
  { path: "/upcoming-events", label: "upcoming events" },
  { path: "/events/month", label: "monthly events" },
  { path: "/events/detail/", label: "event detail listing" },
  { path: "/entertainment", label: "entertainment listings" },
  { path: "/shows", label: "shows listings" },
  { path: "/fw-event-slug/", label: "event slug feed" },
]

const PROBE_TIMEOUT = 15000
const CONTENT_MIN_CHARS = 200
const DATE_PATTERN =
  /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i

interface ProbeResult {
  path: string
  url: string
  valid: boolean
  blocksFound: number
  chars: number
}

async function probe(url: string): Promise<ProbeResult> {
  const result = await jina.scrape(url, { timeout: PROBE_TIMEOUT })
  const chars = result.markdown?.length ?? 0
  const hasDate = DATE_PATTERN.test(result.markdown ?? "")
  const valid = chars >= CONTENT_MIN_CHARS && hasDate

  let blocksFound = 0
  if (valid && result.markdown) {
    const h2s = (result.markdown.match(/^##\s+.+/gm) ?? []).length
    const lis = (result.markdown.match(/^[-*]\s+.+/gm) ?? []).length
    blocksFound = Math.max(h2s, Math.floor(lis / 3), 1)
  }

  return { path: new URL(url).pathname, url, valid, blocksFound, chars }
}

async function main() {
  const DRY_RUN = !process.argv.includes("--confirm")
  const VENUE_ONLY = process.argv.includes("--venue-only")
  console.log(
    `[goldTierDiscover] DRY_RUN=${DRY_RUN} VENUE_ONLY=${VENUE_ONLY}\n`
  )

  const sources = await prisma.venueDirectorySource.findMany({
    where: { isActive: true },
    include: {
      venue: { select: { id: true, name: true } },
      directory: { select: { id: true, baseUrl: true } },
    },
  })

  const byBase = new Map<string, typeof sources>()
  for (const src of sources) {
    if (!byBase.has(src.directory.baseUrl))
      byBase.set(src.directory.baseUrl, [])
    byBase.get(src.directory.baseUrl)!.push(src)
  }

  console.log(
    `[goldTierDiscover] ${sources.length} active sources across ${byBase.size} directories\n`
  )

  let keptActive = 0
  let deactivated = 0
  let newlyActive = 0
  let noGoodGold = 0

  for (const [baseUrl, srcs] of byBase) {
    const venueName = srcs[0].venue.name
    console.log(`\n[goldTierDiscover] ${venueName}: ${baseUrl}`)

    const base = baseUrl.replace(/\/+$/, "")

    const probeResults: ProbeResult[] = []

    for (const gt of GOLD_TIER_PATTERNS) {
      const url = `${base}${gt.path.startsWith("/") ? gt.path : "/" + gt.path}`
      process.stdout.write(`  probing ${gt.path}... `)
      try {
        const r = await probe(url)
        probeResults.push(r)
        process.stdout.write(
          `${r.valid ? "✓" : "✗"} (${r.chars} chars, ${r.blocksFound} blocks)\n`
        )
      } catch (e) {
        process.stdout.write(
          `err: ${e instanceof Error ? e.message : String(e)}\n`
        )
        probeResults.push({
          path: gt.path,
          url,
          valid: false,
          blocksFound: 0,
          chars: 0,
        })
      }
    }

    const validResults = probeResults.filter((r) => r.valid)
    console.log(
      `  → ${validResults.length}/${probeResults.length} gold paths valid`
    )

    if (validResults.length === 0) {
      console.log(`  → no valid gold paths found — marking all sources broken`)
      for (const src of srcs) {
        if (!DRY_RUN) {
          await prisma.venueDirectorySource.update({
            where: { id: src.id },
            data: { isActive: false, healthStatus: "broken" },
          })
        }
        console.log(`    deactivating: ${new URL(src.sourceUrl!).pathname}`)
        deactivated++
      }
      noGoodGold++
      continue
    }

    const best = validResults.sort((a, b) => b.blocksFound - a.blocksFound)[0]
    console.log(
      `  → best: ${best.path} (${best.blocksFound} blocks, ${best.chars} chars)`
    )

    const activePaths = new Set<string>()
    for (const src of srcs) {
      const srcPath = new URL(src.sourceUrl!).pathname
      const isCurrentGold = validResults.some((r) => r.path === srcPath)

      if (!isCurrentGold) {
        if (!DRY_RUN) {
          await prisma.venueDirectorySource.update({
            where: { id: src.id },
            data: { isActive: false, healthStatus: "valid" },
          })
        }
        console.log(`    deactivating non-best: ${srcPath}`)
        deactivated++
        continue
      }

      activePaths.add(srcPath)
      keptActive++
    }

    for (const r of validResults) {
      if (activePaths.has(r.path)) continue

      const existing = srcs.find(
        (s) => new URL(s.sourceUrl!).pathname === r.path
      )
      if (existing) {
        if (!DRY_RUN) {
          await prisma.venueDirectorySource.update({
            where: { id: existing.id },
            data: { isActive: true, healthStatus: "valid" },
          })
        }
        console.log(`    reactivating: ${r.path}`)
        newlyActive++
      } else {
        if (!DRY_RUN) {
          await prisma.venueDirectorySource.create({
            data: {
              directoryId: srcs[0].directoryId,
              venueId: srcs[0].venueId,
              sourceUrl: r.url,
              strategy: "jina_markdown",
              isActive: true,
              healthStatus: "valid",
              batchSize: 5,
              batchDelayMs: 10000,
            },
          })
        }
        console.log(`    creating: ${r.path}`)
        newlyActive++
      }
    }
  }

  console.log(`\n[goldTierDiscover] ═══ RESULTS ═══`)
  console.log(`[goldTierDiscover]   Kept active:      ${keptActive}`)
  console.log(`[goldTierDiscover]   Deactivated:    ${deactivated}`)
  console.log(`[goldTierDiscover]   Newly activated: ${newlyActive}`)
  console.log(`[goldTierDiscover]   No good gold:   ${noGoodGold}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
