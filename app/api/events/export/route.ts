import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import * as XLSX from "xlsx"

export async function GET() {
  const events = await prisma.event.findMany({
    include: { location: true, sourceSite: true },
    orderBy: { eventDateStart: "asc" },
  })

  const rows = events.map((e) => ({
    "Event Name": e.eventName,
    Location: e.location.name,
    "Contact Name": e.organizerName ?? "",
    "Contact Title": e.organizerTitle ?? "",
    Phone: e.organizerPhone ?? "",
    Email: e.organizerEmail ?? "",
    "Date of Event": e.eventDateStart ? new Date(e.eventDateStart).toLocaleDateString() : "",
    Status: e.status,
    "Source URL": e.sourceUrl ?? "",
    "Source Site": e.sourceSite?.name ?? "",
    "Date Added": new Date(e.dateAdded).toLocaleDateString(),
  }))

  const ws = XLSX.utils.json_to_sheet(rows)

  // Set column widths for readability
  ws["!cols"] = [
    { wch: 40 }, // Event Name
    { wch: 30 }, // Location
    { wch: 25 }, // Contact Name
    { wch: 25 }, // Contact Title
    { wch: 18 }, // Phone
    { wch: 30 }, // Email
    { wch: 15 }, // Date of Event
    { wch: 12 }, // Status
    { wch: 50 }, // Source URL
    { wch: 25 }, // Source Site
    { wch: 15 }, // Date Added
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Events")

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="events-export-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  })
}
