import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import * as XLSX from "xlsx"

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buf = Buffer.from(await file.arrayBuffer())
    const wb = XLSX.read(buf, { type: "buffer" })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws)

    if (rows.length === 0) {
      return NextResponse.json({ error: "Spreadsheet is empty" }, { status: 400 })
    }

    const results = { created: 0, skipped: 0, errors: 0, details: [] as string[] }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2

      try {
        const eventName = row["Event Name"]?.trim()
        if (!eventName) {
          results.errors++
          results.details.push(`Row ${rowNum}: missing Event Name`)
          continue
        }

        // Resolve location by name (case-insensitive, fallback to first venue-like match)
        const locationName = row["Location"]?.trim()
        let locationId: string | null = null

        if (locationName) {
          const location = await prisma.location.findFirst({
            where: { name: { contains: locationName, mode: "insensitive" }, type: "VENUE" },
            select: { id: true },
          })
          if (location) {
            locationId = location.id
          }
        }

        if (!locationId) {
          results.errors++
          results.details.push(`Row ${rowNum}: could not find venue "${locationName}" for event "${eventName}"`)
          continue
        }

        // Parse dates
        let eventDateStart: Date | undefined
        let eventDateEnd: Date | undefined

        if (row["Date of Event"]?.trim()) {
          const parsed = new Date(row["Date of Event"])
          if (!isNaN(parsed.getTime())) {
            eventDateStart = parsed
            // If it's a single cell date, we store it as start
          }
        }

        // Check for duplicate by eventName + locationId + eventDateStart
        const existing = await prisma.event.findFirst({
          where: {
            eventName,
            locationId,
            eventDateStart: eventDateStart ?? null,
          },
          select: { id: true },
        })
        if (existing) {
          results.skipped++
          results.details.push(`Row ${rowNum}: duplicate event "${eventName}"`)
          continue
        }

        await prisma.event.create({
          data: {
            eventName,
            locationId,
            eventDateStart: eventDateStart ?? null,
            eventDateEnd: eventDateEnd ?? null,
            sourceUrl: row["Source URL"]?.trim() || null,
            organizerName: row["Contact Name"]?.trim() || null,
            organizerTitle: row["Contact Title"]?.trim() || null,
            organizerEmail: row["Email"]?.trim() || null,
            organizerPhone: row["Phone"]?.trim() || null,
            contactNote: row["Notes"]?.trim() || null,
            status: matchStatus(row["Status"]?.trim()),
          },
        })

        results.created++
      } catch (err) {
        results.errors++
        results.details.push(`Row ${rowNum}: error — ${err instanceof Error ? err.message : "unknown"}`)
      }
    }

    return NextResponse.json(results)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to process file" },
      { status: 500 }
    )
  }
}

function matchStatus(val?: string): "new" | "reviewed" | "contacted" {
  if (!val) return "new"
  const lower = val.toLowerCase()
  if (lower === "reviewed") return "reviewed"
  if (lower === "contacted") return "contacted"
  return "new"
}
