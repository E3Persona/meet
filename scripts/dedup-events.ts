import "dotenv/config"
import { prisma } from "../lib/prisma"

async function main() {
  console.log("[Dedup] Finding duplicate events by name...")

  const allEvents = await prisma.event.findMany({
    select: {
      id: true,
      eventName: true,
      eventDateStart: true,
      eventDateEnd: true,
      locationId: true,
      location: { select: { name: true, city: true } },
    },
    orderBy: { eventName: "asc" },
  })

  // Group by eventName only
  const groups = new Map<string, typeof allEvents>()
  for (const ev of allEvents) {
    if (!groups.has(ev.eventName)) groups.set(ev.eventName, [])
    groups.get(ev.eventName)!.push(ev)
  }

  let totalRemoved = 0
  let totalGroups = 0

  for (const [name, group] of groups) {
    if (group.length < 2) continue
    totalGroups++

    const ids = group.map((e) => e.id)

    // Fetch full data to score
    const full = await prisma.event.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        locationId: true,
        eventDateStart: true,
        eventDateEnd: true,
        organizerName: true,
        organizerEmail: true,
        organizerPhone: true,
        rawVenueText: true,
        rawLocationText: true,
        contactNote: true,
        contacts: { select: { id: true } },
        location: { select: { name: true, city: true } },
      },
    })

    if (full.length < 2) continue

    // Score: prefer the one with most data filled
    const scored = full.map((e) => ({
      ...e,
      score:
        (e.contacts.length > 0 ? 4 : 0) +
        (e.organizerName ? 2 : 0) +
        (e.organizerEmail ? 2 : 0) +
        (e.organizerPhone ? 1 : 0) +
        (e.rawVenueText ? 1 : 0) +
        (e.rawLocationText ? 1 : 0) +
        (e.contactNote ? 1 : 0) +
        (e.eventDateEnd ? 1 : 0),
    }))
    scored.sort((a, b) => b.score - a.score)
    const keep = scored[0]
    const toRemove = scored.filter((e) => e.id !== keep.id)

    // Backlink: collect venue + date info from removed rows
    const removedVenues = [...new Set(toRemove.map((e) => e.location.name).filter(Boolean))]
    const removedDates = toRemove
      .map((e) => e.eventDateStart?.toISOString().split("T")[0])
      .filter(Boolean)

    // Merge date info: keep earliest start, latest end
    const allDates = [keep, ...toRemove].map((e) => e.eventDateStart).filter(Boolean) as Date[]
    const allEndDates = [keep, ...toRemove].map((e) => e.eventDateEnd).filter(Boolean) as Date[]
    const minStart = allDates.length > 0 ? allDates.reduce((a, b) => (a < b ? a : b)) : keep.eventDateStart
    const maxEnd = allEndDates.length > 0 ? allEndDates.reduce((a, b) => (a > b ? a : b)) : keep.eventDateEnd

    // Build backlink text
    let backlink = ""
    if (removedVenues.length > 0) {
      backlink = ` (also at: ${removedVenues.join(", ")})`
    }
    if (removedDates.length > 0) {
      backlink += ` (also on: ${removedDates.join(", ")})`
    }

    // Delete duplicates FIRST (to avoid unique constraint conflicts when updating dates)
    const removeIds = toRemove.map((e) => e.id)
    const del = await prisma.event.deleteMany({
      where: { id: { in: removeIds } },
    })
    totalRemoved += del.count

    // THEN update kept event: merge dates + backlink removed info
    await prisma.event.update({
      where: { id: keep.id },
      data: {
        eventDateStart: minStart,
        eventDateEnd: maxEnd,
        rawVenueText: keep.rawVenueText
          ? keep.rawVenueText + (backlink || "")
          : (keep.location.name ?? "") + (backlink || ""),
      },
    })

    console.log(
      `  "${name.slice(0, 60)}" → kept at ${keep.location.name}` +
      `, deleted ${del.count} (venues: ${removedVenues.join(", ") || "same venue"})`
    )
  }

  console.log(`\n[Dedup] Done. ${totalGroups} names had duplicates, removed ${totalRemoved} rows.`)
}

main()
  .catch((e) => {
    console.error("[Dedup] Fatal:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
