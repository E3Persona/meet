import { NextResponse } from "next/server"
import { prisma, withRetry } from "@/lib/prisma"
import { getSheetsClient, HEADERS } from "@/lib/google-sheets/client"

export async function POST() {
  const apiKey = process.env.GOOGLE_SHEETS_SYNC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 })
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  if (!spreadsheetId) {
    return NextResponse.json({ error: "Spreadsheet ID not configured" }, { status: 500 })
  }

  const events = await withRetry(() =>
    prisma.event.findMany({
      include: {
        location: { select: { name: true, city: true, type: true } },
      },
      orderBy: { eventDateStart: "asc" },
    })
  )

  const rows = events.map((e) => [
    e.eventName,
    e.eventDateStart ? e.eventDateStart.toISOString().split("T")[0] : "",
    e.eventDateEnd   ? e.eventDateEnd.toISOString().split("T")[0]   : "",
    e.location.type === "CITY"  ? e.location.name : e.location.city ?? "",
    e.location.type === "VENUE" ? e.location.name : "",
    e.organizerName   ?? "",
    e.organizerTitle  ?? "",
    e.organizerEmail  ?? "",
    e.organizerPhone  ?? "",
    e.status,
    e.sourceUrl ?? "",
    e.dateAdded ? e.dateAdded.toISOString().split("T")[0] : "",
  ])

  try {
    const sheets = await getSheetsClient()
    const range = "Sheet1!A1:L"

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range,
    })

    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: "Sheet1!A1:L1",
      valueInputOption: "RAW",
      requestBody: {
        values: [HEADERS],
      },
    })

    if (rows.length > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Sheet1!A2:L${rows.length + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: rows },
      })
    }

    return NextResponse.json({ pushed: rows.length, success: true })
  } catch (err) {
    console.error("[/api/events/export-sheet]", err)
    return NextResponse.json({ error: "Failed to write to Google Sheet" }, { status: 502 })
  }
}
