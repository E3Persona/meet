import { prisma } from "@/lib/prisma"
import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"

interface BatchEntry {
  venueName: string
  officialSite: string | null
  directories: string[]
  batchStatus: string
  rawStatus: string
}

interface VenueMatch {
  dbVenue: {
    id: string
    name: string
    city: string | null
    state: string | null
  }
  score: number
}

const BATCH_DIR = path.join(__dirname, "..", "batch")
const BATCH_FILES = [
  path.join(BATCH_DIR, "batch1.md"),
  path.join(BATCH_DIR, "batch2.md"),
  path.join(BATCH_DIR, "batch3.md"),
  path.join(BATCH_DIR, "batch4.md"),
  path.join(BATCH_DIR, "batch5.md"),
  path.join(BATCH_DIR, "batch6.md"),
]

const HEALTH_MAP: Record<string, "valid" | "unconfirmed" | "broken"> = {
  verified: "valid",
  high: "valid",
  medium: "unconfirmed",
  low: "unconfirmed",
  candidate: "unconfirmed",
}

const GOLD_TIER_PATTERNS = [
  "/events",
  "/calendar",
  "/upcoming-events",
  "/events/month",
  "/events/detail/",
  "/entertainment",
  "/shows",
  "/fw-event-slug/",
]

function isGoldTier(path: string): boolean {
  const clean = path.replace(/`/g, "").replace(/\*$/, "").trim().toLowerCase()
  return GOLD_TIER_PATTERNS.some((p) => clean.startsWith(p) || clean === p)
}

async function main() {
  const DRY_RUN = !process.argv.includes("--confirm")
  console.log(`[batchAttach] DRY_RUN=${DRY_RUN}\n`)

  const allEntries: (BatchEntry & { source: string })[] = []
  for (const f of BATCH_FILES) {
    const entries = parseBatchFile(f)
    console.log(`[batchAttach] ${path.basename(f)}: ${entries.length} entries`)
    allEntries.push(...entries.map((e) => ({ ...e, source: path.basename(f) })))
  }

  const seen = new Map<string, BatchEntry & { source: string }>()
  const duplicates: string[] = []
  for (const e of allEntries) {
    const key = e.venueName.toLowerCase().replace(/\s+/g, " ").trim()
    if (seen.has(key)) {
      duplicates.push(
        `  "${e.venueName}" also in ${e.source} (already processed from ${seen.get(key)!.source})`
      )
    } else {
      seen.set(key, e)
    }
  }
  if (duplicates.length > 0) {
    console.log(
      `\n[batchAttach] Duplicate entries across batches (flagged, not silently merged):`
    )
    duplicates.forEach((d) => console.log(d))
  }

  const uniqueEntries = [...seen.values()]
  console.log(
    `\n[batchAttach] ${uniqueEntries.length} unique venues after dedup\n`
  )

  const dbVenues = await prisma.location.findMany({
    where: { type: "VENUE" },
    select: { id: true, name: true, city: true, state: true },
  })

  const matched: Array<
    BatchEntry & { db: VenueMatch["dbVenue"]; score: number; source: string }
  > = []
  const unmatched: Array<
    BatchEntry & { source: string; closestMatch: VenueMatch | null }
  > = []

  for (const entry of uniqueEntries) {
    const match = findBestVenueMatch(entry.venueName, dbVenues)
    if (match && match.score >= 0.5) {
      matched.push({ ...entry, db: match.dbVenue, score: match.score })
    } else {
      unmatched.push({ ...entry, closestMatch: match })
    }
  }

  console.log(`[batchAttach] MATCHED (score ≥ 0.5): ${matched.length}`)
  console.log(`[batchAttach] NEEDS REVIEW:           ${unmatched.length}\n`)

  if (unmatched.length > 0) {
    console.log(`[batchAttach] ═══ REVIEW LIST (venue not found in DB) ═══`)
    for (const e of unmatched) {
      const closest = e.closestMatch
        ? `${e.closestMatch.dbVenue.name} (${e.closestMatch.dbVenue.city}, ${e.closestMatch.dbVenue.state}) score=${e.closestMatch.score.toFixed(2)}`
        : "no close match"
      console.log(`  "${e.venueName}" [${e.source}]`)
      console.log(`    → closest: ${closest}`)
      console.log(`    → dirs: ${e.directories.join(", ")}`)
    }
    console.log()
  }

  if (DRY_RUN) {
    console.log(
      `[batchAttach] DRY RUN — no rows created. Run with --confirm to write to DB.`
    )
    await prisma.$disconnect()
    return
  }

  let dirsCreated = 0
  let sourcesCreated = 0
  let sourcesSkipped = 0

  for (let i = 0; i < matched.length; i++) {
    const entry = matched[i]
    if (i % 5 === 0)
      console.log(`[batchAttach] Writing ${i}/${matched.length}...`)
    const healthStatus = HEALTH_MAP[entry.batchStatus] ?? "unconfirmed"

    for (const dirPath of entry.directories) {
      if (!dirPath || dirPath.trim() === "") continue

      const cleanPath = dirPath.replace(/`/g, "").replace(/\*$/, "").trim()
      if (!cleanPath) continue

      const officialSite = entry.officialSite ?? ""
      let baseUrl = ""
      try {
        baseUrl = officialSite.startsWith("http")
          ? officialSite
          : `https://${officialSite}`
        new URL(baseUrl)
      } catch {
        baseUrl = `https://${officialSite}`
      }

      const fullUrl =
        baseUrl.replace(/\/+$/, "") +
        (cleanPath.startsWith("/") ? cleanPath : "/" + cleanPath)
      let dirType: "official_site" | "per_venue_page" = "per_venue_page"
      let sourceUrl = fullUrl

      if (cleanPath === "/" || entry.directories.indexOf(dirPath) === 0) {
        const isOfficialSiteDir =
          entry.officialSite !== null &&
          (cleanPath === "/" ||
            cleanPath ===
              entry.directories
                .find((d) => !d.includes("`"))
                ?.replace(/`/g, "")
                .replace(/\*$/, "")
                .trim())
        if (isOfficialSiteDir && entry.directories.indexOf(dirPath) === 0) {
          dirType = "official_site"
          sourceUrl = baseUrl
        }
      }

      console.log(`  [batchAttach] upsert dir: ${baseUrl.replace(/\/+$/, "")}`)
      const directory = await prisma.directory.upsert({
        where: { baseUrl: baseUrl.replace(/\/+$/, "") },
        create: {
          name: baseUrl.replace(/^https?:\/\//, "").split("/")[0],
          baseUrl: baseUrl.replace(/\/+$/, ""),
          type: dirType,
        },
        update: {},
      })
      dirsCreated++

      const existing = await prisma.venueDirectorySource.findUnique({
        where: {
          directoryId_venueId_sourceUrl: {
            directoryId: directory.id,
            venueId: entry.db.id,
            sourceUrl,
          },
        },
      })
      if (existing) {
        sourcesSkipped++
        continue
      }

      await prisma.venueDirectorySource.create({
        data: {
          directoryId: directory.id,
          venueId: entry.db.id,
          sourceUrl,
          strategy: "jina_markdown",
          isActive: true,
          healthStatus,
          batchSize: 5,
          batchDelayMs: 10000,
        },
      })
      sourcesCreated++
    }
  }

  console.log(`\n[batchAttach] ═══ RESULTS ═══`)
  console.log(`[batchAttach]   Directories created:   ${dirsCreated}`)
  console.log(`[batchAttach]   VenueDirectorySources: ${sourcesCreated}`)
  console.log(`[batchAttach]   Already existed:        ${sourcesSkipped}`)
  console.log(`[batchAttach]   Unmatched (review):     ${unmatched.length}`)

  await prisma.$disconnect()
}

function parseBatchFile(filePath: string): BatchEntry[] {
  const content = fs.readFileSync(filePath, "utf-8")
  const entries: BatchEntry[] = []

  const lines = content.split("\n")
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    if (
      line.startsWith("|") &&
      line.includes("Venue") &&
      line.includes("Official Site") &&
      line.includes("Directory")
    ) {
      const headers = parseMdRow(line)
      const colMap = headers.map((h, idx) => ({ h: h.trim(), idx }))
      const venueIdx = colMap.findIndex((c) => c.h === "Venue")
      const officialIdx = colMap.findIndex((c) => c.h === "Official Site")
      const statusIdx = colMap.findIndex(
        (c) =>
          c.h.toLowerCase().includes("status") ||
          c.h.toLowerCase().includes("confidence")
      )
      const hasStatusCol = statusIdx !== -1
      const hasOfficialCol = officialIdx !== -1

      i++
      while (i < lines.length && !lines[i].trim().startsWith("|")) i++
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const row = parseMdRow(lines[i].trim())
        if (row.length >= 2 && row[0] !== "" && !row[0].startsWith("-")) {
          const venueName = cleanVenueName(row[venueIdx] ?? "")
          if (venueName) {
            const rawStatus = hasStatusCol
              ? (row[statusIdx] ?? "unconfirmed").toLowerCase().trim()
              : "unconfirmed"
            const batchStatus = rawStatus.replace(/[*`]/g, "").trim()

            const directories: string[] = []
            if (hasOfficialCol) {
              for (
                let j = officialIdx + 1;
                j < (hasStatusCol ? statusIdx : row.length);
                j++
              ) {
                const cell = row[j] ?? ""
                const parts = cell
                  .split(",")
                  .map((p: string) => p.trim())
                  .filter(Boolean)
                directories.push(...parts)
              }
            } else {
              for (let j = venueIdx + 1; j < row.length; j++) {
                if (row[j]) directories.push(row[j])
              }
            }

            const officialSite = hasOfficialCol
              ? (row[officialIdx] ?? "").replace(/`/g, "").trim()
              : null

            entries.push({
              venueName,
              officialSite:
                officialSite && officialSite !== "" ? officialSite : null,
              directories,
              batchStatus,
              rawStatus,
            })
          }
        }
        i++
      }
    } else {
      i++
    }
  }

  return entries
}

function parseMdRow(line: string): string[] {
  const result: string[] = []
  let current = ""
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === "|") {
      result.push(current.trim())
      current = ""
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result.filter((s, i) => i > 0 && s !== "" && !s.match(/^-+$/))
}

function cleanVenueName(name: string): string {
  return name.replace(/`/g, "").replace(/\*/g, "").trim()
}

function findBestVenueMatch(
  venueName: string,
  dbVenues: {
    id: string
    name: string
    city: string | null
    state: string | null
  }[]
): VenueMatch | null {
  const clean = normalize(venueName)
  let best: VenueMatch | null = null

  for (const v of dbVenues) {
    const nameScore = similarity(clean, normalize(v.name))
    let finalScore = nameScore

    if (nameScore < 0.5 && v.city) {
      const cityNorm = normalize(v.city)
      if (
        clean === cityNorm ||
        clean.includes(cityNorm) ||
        cityNorm.includes(clean)
      ) {
        const words = clean.split(/\s+/)
        const cityWords = cityNorm.split(/\s+/)
        const overlap = words.filter((w: string) =>
          cityWords.includes(w)
        ).length
        if (overlap >= Math.min(2, cityWords.length)) {
          finalScore = Math.max(nameScore, 0.45)
        }
      }
    }

    if (finalScore >= 0.5 && (!best || finalScore > best.score)) {
      best = { dbVenue: v, score: finalScore }
    }
  }

  return best
}

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

function similarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  if (a.includes(b) || b.includes(a)) {
    const longer = a.length > b.length ? a : b
    const shorter = a.length > b.length ? b : a
    return 0.7 + 0.3 * (shorter.length / longer.length)
  }

  const aWords = new Set(a.split(/\s+/))
  const bWords = new Set(b.split(/\s+/))
  const intersect = [...aWords].filter((w) => bWords.has(w)).length
  const union = new Set([...aWords, ...bWords]).size
  if (union === 0) return 0
  const jaccard = intersect / union

  const lev = levenshtein(a, b)
  const lenNorm = 1 - lev / Math.max(a.length, b.length)

  return jaccard * 0.5 + lenNorm * 0.5
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0
    )
  )
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[a.length][b.length]
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
