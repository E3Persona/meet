import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import * as XLSX from "xlsx"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const month = searchParams.get("month") // "1"-"12" or null for all
  const year = searchParams.get("year") // "2026" etc or null for all

  const where: Record<string, any> = {}

  if (month && year) {
    const m = parseInt(month, 10)
    const y = parseInt(year, 10)
    const start = new Date(Date.UTC(y, m - 1, 1))
    const end = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
    where.eventDateStart = { gte: start, lte: end }
  } else if (year) {
    const y = parseInt(year, 10)
    const start = new Date(Date.UTC(y, 0, 1))
    const end = new Date(Date.UTC(y, 11, 31, 23, 59, 59, 999))
    where.eventDateStart = { gte: start, lte: end }
  } else if (month) {
    const m = parseInt(month, 10)
    where.eventDateStart = {
      gte: new Date(Date.UTC(2020, m - 1, 1)),
      lte: new Date(Date.UTC(2030, m, 0, 23, 59, 59, 999)),
    }
  }

  const events = await prisma.event.findMany({
    where,
    include: { location: true, sourceSite: true, contacts: true },
    orderBy: { dateAdded: "desc" },
  })

  const rows = events.map((e) => {
    const primary = e.contacts?.find((c) => c.isPrimary) ?? e.contacts?.[0]
    const isPast = e.eventDateEnd
      ? new Date(e.eventDateEnd) < new Date()
      : e.eventDateStart
        ? new Date(e.eventDateStart) < new Date()
        : false
    return {
      "Event Name": e.eventName,
      Location: e.location.name,
      "Contact Name": primary?.name ?? e.organizerName ?? "",
      "Contact Title": primary?.title ?? e.organizerTitle ?? "",
      Phone: primary?.phone ?? e.organizerPhone ?? "",
      Email: primary?.email ?? e.organizerEmail ?? "",
      "Date of Event": e.eventDateStart
        ? new Date(e.eventDateStart).toLocaleDateString()
        : "",
      Status: isPast ? `${e.status} (Past)` : e.status,
      Notes: e.contactNote ?? "",
      "Source URL": e.sourceUrl ?? "",
      "Source Site": e.sourceSite?.name ?? "",
      "Date Added": new Date(e.dateAdded).toLocaleDateString(),
    }
  })

  const ws = XLSX.utils.json_to_sheet(rows)

  ws["!cols"] = [
    { wch: 40 },
    { wch: 30 },
    { wch: 25 },
    { wch: 25 },
    { wch: 18 },
    { wch: 30 },
    { wch: 15 },
    { wch: 15 },
    { wch: 30 },
    { wch: 50 },
    { wch: 25 },
    { wch: 15 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Events")

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

  const monthNames = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ]
  const label = month && year
    ? `${monthNames[parseInt(month)]}-${year}`
    : year
      ? `Year-${year}`
      : month
        ? `${monthNames[parseInt(month)]}-All`
        : new Date().toISOString().slice(0, 10)

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="events-${label}.xlsx"`,
    },
  })
}
