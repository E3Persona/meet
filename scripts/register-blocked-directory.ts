import "dotenv/config"
import { prisma } from "@/lib/prisma"

const BLOCKED_DIRECTORIES = [
  {
    name: "axs.com",
    baseUrl: "https://www.axs.com",
    type: "per_venue_page" as const,
  },
]

async function main() {
  console.log(`[register] Registering ${BLOCKED_DIRECTORIES.length} blocked directory/ies\n`)

  for (const dir of BLOCKED_DIRECTORIES) {
    const existing = await prisma.directory.findUnique({ where: { baseUrl: dir.baseUrl } })
    if (existing) {
      console.log(`[register] Already exists: ${dir.baseUrl} (id=${existing.id})`)
      continue
    }

    const created = await prisma.directory.create({
      data: {
        name: dir.name,
        baseUrl: dir.baseUrl,
        type: dir.type,
      },
    })
    console.log(`[register] Created directory: ${dir.baseUrl} (id=${created.id})`)
  }

  console.log(`\n[register] Done. No VenueDirectorySource rows created — add AXS-managed venue Locations first if you want those.`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("[register] Fatal:", e)
  process.exit(1)
})
