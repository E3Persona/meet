import "dotenv/config"

import { prisma } from "../lib/prisma"

async function main() {
  const sourceId = process.argv[2]
  if (!sourceId) {
    console.error("Usage: npx tsx scripts/approveSuggestion.ts <sourceId>")
    process.exit(1)
  }

  const source = await prisma.venueDirectorySource.findUnique({
    where: { id: sourceId },
  })
  if (!source) {
    console.error(`[approveSuggestion] Source ${sourceId} not found`)
    process.exit(1)
  }

  if (source.healthStatus !== "suggested_correction") {
    console.error(
      `[approveSuggestion] Source is "${source.healthStatus}", not "suggested_correction". Nothing to approve.`
    )
    process.exit(1)
  }

  if (!source.suggestedUrl) {
    console.error(`[approveSuggestion] Source has no suggestedUrl.`)
    process.exit(1)
  }

  console.log(`[approveSuggestion] About to approve:`)
  console.log(`  Source:    ${source.sourceUrl}`)
  console.log(`  Suggested: ${source.suggestedUrl}`)
  console.log(`  Method:    ${source.discoveryMethod}`)
  console.log(`  Confidence: ${source.discoveryConfidence}`)

  const confirm = process.argv[3]
  if (confirm !== "--confirm") {
    console.log(`\nRun with --confirm to apply:`)
    console.log(`  npx tsx scripts/approveSuggestion.ts ${sourceId} --confirm`)
    await prisma.$disconnect()
    return
  }

  await prisma.venueDirectorySource.update({
    where: { id: sourceId },
    data: {
      originalSourceUrl: source.sourceUrl,
      sourceUrl: source.suggestedUrl,
      healthStatus: "valid",
      suggestedUrl: null,
      discoveryMethod: null,
      discoveryConfidence: null,
      lastFullHash: null,
      nextCheckAt: new Date(),
    },
  })

  console.log(
    `[approveSuggestion] ✓ Done — original URL preserved in originalSourceUrl, new URL set as sourceUrl`
  )
  await prisma.$disconnect()
}

main()
