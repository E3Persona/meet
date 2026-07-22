import { prisma } from "@/lib/prisma"

const GOLD_TIER_PATTERNS: Array<{ pattern: string; replacement: string }> = [
  { pattern: "/events", replacement: "/events" },
  { pattern: "/calendar", replacement: "/calendar" },
  { pattern: "/upcoming-events", replacement: "/upcoming-events" },
  { pattern: "/events/month", replacement: "/events/month" },
  { pattern: "/events/detail/", replacement: "/events/detail/" },
  { pattern: "/entertainment", replacement: "/entertainment" },
  { pattern: "/shows", replacement: "/shows" },
  { pattern: "/fw-event-slug/", replacement: "/fw-event-slug/" },
]

const ALL_GOLD_PATTERNS = GOLD_TIER_PATTERNS.map((p) => p.pattern)

function extractPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url
  }
}

function isGoldTier(path: string): boolean {
  const clean = path.toLowerCase()
  return ALL_GOLD_PATTERNS.some((p) => clean.startsWith(p) || clean === p)
}

function matchGoldTier(path: string): string | null {
  const clean = path.toLowerCase()
  for (const p of ALL_GOLD_PATTERNS) {
    if (clean.startsWith(p) || clean === p) return p
  }
  return null
}

async function main() {
  const DRY_RUN = !process.argv.includes("--confirm")
  console.log(`[goldTierFilter] DRY_RUN=${DRY_RUN}\n`)

  const sources = await prisma.venueDirectorySource.findMany({
    where: { isActive: true },
    include: {
      venue: { select: { name: true } },
      directory: { select: { baseUrl: true } },
    },
  })

  console.log(`[goldTierFilter] ${sources.length} active sources to check\n`)

  let goldKept = 0
  let goldAdded = 0
  let nonGoldDeactivated = 0
  let noGoldAvailable = 0

  for (const src of sources) {
    const path = extractPath(src.sourceUrl!)
    const goldMatch = matchGoldTier(path)

    if (goldMatch) {
      goldKept++
      if (DRY_RUN)
        console.log(`[goldTierFilter] ✓ KEEP: ${src.venue.name} → ${path}`)
      continue
    }

    console.log(`[goldTierFilter] ✗ DEACTIVATE: ${src.venue.name} → ${path}`)

    if (!DRY_RUN) {
      await prisma.venueDirectorySource.update({
        where: { id: src.id },
        data: { isActive: false },
      })
    }
    nonGoldDeactivated++

    const baseUrl = src.directory.baseUrl
    for (const gt of GOLD_TIER_PATTERNS) {
      const newPath = gt.replacement
      const newUrl = `${baseUrl.replace(/\/+$/, "")}${newPath.startsWith("/") ? newPath : "/" + newPath}`

      const existing = await prisma.venueDirectorySource.findFirst({
        where: {
          venueId: src.venueId,
          sourceUrl: newUrl,
        },
      })

      if (existing) {
        if (!DRY_RUN) {
          await prisma.venueDirectorySource.update({
            where: { id: existing.id },
            data: { isActive: true },
          })
        }
        console.log(`[goldTierFilter]   + REACTIVATE gold: ${newPath}`)
        goldAdded++
      } else {
        if (!DRY_RUN) {
          await prisma.venueDirectorySource.create({
            data: {
              directoryId: src.directoryId,
              venueId: src.venueId,
              sourceUrl: newUrl,
              strategy: "jina_markdown",
              isActive: true,
              healthStatus: "unconfirmed",
              batchSize: 5,
              batchDelayMs: 10000,
            },
          })
        }
        console.log(`[goldTierFilter]   + CREATE gold: ${newPath}`)
        goldAdded++
      }
    }
  }

  console.log(`\n[goldTierFilter] ═══ RESULTS ═══`)
  console.log(`[goldTierFilter]   Gold paths kept:     ${goldKept}`)
  console.log(`[goldTierFilter]   Non-gold deactivated: ${nonGoldDeactivated}`)
  console.log(`[goldTierFilter]   Gold sources added:  ${goldAdded}`)
  console.log(`[goldTierFilter]   No gold match:       ${noGoldAvailable}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
