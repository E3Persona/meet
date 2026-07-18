import { NextResponse } from "next/server"
import { prisma, withRetry } from "@/lib/prisma"

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? ""
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim()

  if (!apiKey || apiKey !== process.env.GOOGLE_SHEETS_SYNC_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const webhookUrl = process.env.GOOGLE_SHEETS_WEBHOOK_URL
  if (!webhookUrl) {
    return NextResponse.json(
      { error: "GOOGLE_SHEETS_WEBHOOK_URL is not configured" },
      { status: 500 }
    )
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
    e.location.type === "CITY"    ? e.location.name : e.location.city ?? "",
    e.location.type === "VENUE"   ? e.location.name : "",
    e.organizerName   ?? "",
    e.organizerTitle  ?? "",
    e.organizerEmail  ?? "",
    e.organizerPhone  ?? "",
    e.status,
    e.sourceUrl ?? "",
    e.dateAdded ? e.dateAdded.toISOString().split("T")[0] : "",
  ])

  try {
    const response = await fetch(webhookUrl, {
      method: "post",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ rows }),
    })

    const json = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: json.error ?? "Sheet sync failed", details: json },
        { status: 502 }
      )
    }

    return NextResponse.json({
      pushed: rows.length,
      success: true,
    })
  } catch (err) {
    console.error("[/api/events/export-sheet]", err)
    return NextResponse.json(
      { error: "Failed to reach Google Sheets webhook" },
      { status: 502 }
    )
  }
}
