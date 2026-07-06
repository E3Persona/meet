import { NextResponse } from "next/server"
import * as XLSX from "xlsx"

export async function GET() {
  const headers = [
    "Event Name",
    "Location",
    "Contact Name",
    "Contact Title",
    "Phone",
    "Email",
    "Date of Event",
    "Status",
    "Notes",
    "Source URL",
  ]

  const rows = [
    {
      "Event Name": "Example Annual Conference 2026",
      Location: "Philadelphia Convention Center",
      "Contact Name": "Jane Smith",
      "Contact Title": "Event Coordinator",
      Phone: "(215) 555-0123",
      Email: "jane@example.com",
      "Date of Event": "2026-09-15",
      Status: "new",
      Notes: "Prefers email contact",
      "Source URL": "https://example.com/event",
    },
    {
      "Event Name": "Tech Summit 2026",
      Location: "Walter E. Washington Convention Center",
      "Contact Name": "",
      "Contact Title": "",
      Phone: "",
      Email: "",
      "Date of Event": "2026-10-01",
      Status: "new",
      Notes: "",
      "Source URL": "",
    },
  ]

  const ws = XLSX.utils.json_to_sheet(rows, { header: headers })

  ws["!cols"] = [
    { wch: 40 },
    { wch: 35 },
    { wch: 25 },
    { wch: 25 },
    { wch: 18 },
    { wch: 30 },
    { wch: 15 },
    { wch: 12 },
    { wch: 30 },
    { wch: 50 },
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, "Events Import")

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" })

  return new NextResponse(buf, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition":
        'attachment; filename="event-import-template.xlsx"',
    },
  })
}
