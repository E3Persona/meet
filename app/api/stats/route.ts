import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const now = new Date()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const [totalLocations, totalEvents, newThisWeek, lastRun, totalTemplates, totalSourceSites, eventsMissingContacts, eventsWithContacts] = await Promise.all([
    prisma.location.count({ where: { active: true } }),
    prisma.event.count(),
    prisma.event.count({ where: { dateAdded: { gte: weekAgo } } }),
    prisma.ingestionRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        status: true,
        startedAt: true,
        recordsFound: true,
        recordsNew: true,
        trigger: true,
      },
    }),
    prisma.searchTemplate.count({ where: { active: true } }),
    prisma.sourceSite.count({ where: { active: true } }),
    prisma.event.count({ where: { contacts: { none: {} } } }),
    prisma.event.count({ where: { contacts: { some: {} } } }),
  ])

  return NextResponse.json({
    totalLocations,
    totalEvents,
    newThisWeek,
    lastRun,
    totalTemplates,
    totalSourceSites,
    eventsMissingContacts,
    eventsWithContacts,
  })
}
