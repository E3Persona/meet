import { prisma } from "@/lib/prisma"

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(
      /\s*(hotel|convention center|resort|arena|casino|fairgrounds|museum|stadium|expo|center|plaza|inn|suites|hotel &|conference center)\s*/gi,
      " "
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

async function main() {
  const ac = await prisma.location.findFirst({
    where: {
      name: { equals: "Atlantic City Convention Center", mode: "insensitive" },
      type: "VENUE",
    },
  })
  console.log("AC venue:", JSON.stringify(ac))

  const normBatch = normalize("Atlantic City Convention Center")
  const normDB = normalize(ac!.name)
  console.log("normBatch:", JSON.stringify(normBatch))
  console.log("normDB:", JSON.stringify(normDB))
  console.log("equal:", normBatch === normDB)
}

main()
  .finally(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
