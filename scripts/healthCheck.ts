
import { prisma } from "@/lib/prisma"
import { checkSource } from "../lib/healthCheck"



const CONCURRENCY = 5
const ONLY_BROKEN = process.argv.includes("--only-broken")

async function main() {
  console.log(`[healthCheck] Starting — ONLY_BROKEN=${ONLY_BROKEN}`)

  const sources = await prisma.venueDirectorySource.findMany({
    where: {
      isActive: true,
      ...(ONLY_BROKEN ? { healthStatus: "broken" } : {}),
    },
    include: {
      venue: { select: { name: true } },
      directory: { select: { name: true } },
    },
    take: 50,
  })

  console.log(`[healthCheck] ${sources.length} sources to check\n`)

  const results = []
  let i = 0

  while (i < sources.length) {
    const batch = sources.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.all(
      batch.map((s) =>
        checkSource(s.sourceUrl!, s.venue.name, s.id).catch((e) => ({
          sourceId: s.id,
          url: s.sourceUrl!,
          venueName: s.venue.name,
          status: "broken" as const,
          suggestedUrl: null,
          discoveryMethod: null,
          discoveryConfidence: null,
          blocksFound: 0,
          errorMessage: String(e),
        }))
      )
    )
    results.push(...batchResults)
    i += CONCURRENCY

    for (const r of batchResults) {
      const icon = r.status === "valid" ? "✓" : r.status === "suggested_correction" ? "?" : "✗"
      console.log(`[healthCheck] ${icon} ${r.venueName}: ${r.status}${r.suggestedUrl ? ` → suggest: ${r.suggestedUrl}` : ""}`)
      if (r.errorMessage && r.status !== "valid") console.log(`[healthCheck]   Error: ${r.errorMessage}`)
    }
  }

  for (const r of results) {
    await prisma.venueDirectorySource.update({
      where: { id: r.sourceId },
      data: {
        healthStatus: r.status as "valid" | "broken" | "suggested_correction",
        suggestedUrl: r.suggestedUrl,
        discoveryMethod: r.discoveryMethod,
        discoveryConfidence: r.discoveryConfidence,
        nextCheckAt: new Date(Date.now() + (r.status === "valid" ? 7 : 1) * 24 * 60 * 60 * 1000),
      },
    })
  }

  const valid = results.filter((r) => r.status === "valid").length
  const suggested = results.filter((r) => r.status === "suggested_correction").length
  const broken = results.filter((r) => r.status === "broken").length

  console.log(`\n[healthCheck] ═══════════════════════════════════════`)
  console.log(`[healthCheck] SUMMARY`)
  console.log(`[healthCheck]   Valid:                 ${valid}`)
  console.log(`[healthCheck]   Suggested correction:  ${suggested}`)
  console.log(`[healthCheck]   Broken:                ${broken}`)
  console.log(`[healthCheck] ═══════════════════════════════════════`)

  if (suggested > 0) {
    console.log(`\n[healthCheck] Suggested corrections — review with:`)
    console.log(`[healthCheck]   npx tsx scripts/approveSuggestion.ts <sourceId>`)
    for (const r of results.filter((r) => r.status === "suggested_correction")) {
      console.log(`[healthCheck]   ${r.sourceId}  "${r.venueName}"  → ${r.suggestedUrl}`)
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
