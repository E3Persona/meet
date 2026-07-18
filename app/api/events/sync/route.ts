import { NextResponse } from "next/server"
import { prisma, withRetry } from "@/lib/prisma"

function authCheck(request: Request): Response | null {
  const authHeader = request.headers.get("authorization") ?? ""
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim()
  if (!apiKey || apiKey !== process.env.GOOGLE_SHEETS_SYNC_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

// POST — receives a new/edited row from Google Sheets, upserts into DB
export async function POST(request: Request) {
  const authError = authCheck(request)
  if (authError) return authError

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const {
    eventName,
    eventDateStart,
    eventDateEnd,
    city,
    venue,
    organizerName,
    organizerTitle,
    organizerEmail,
    organizerPhone,
    status = "new",
    sourceUrl,
    dateAdded,
  } = body

  if (!eventName || typeof eventName !== "string" || !eventName.trim()) {
    return NextResponse.json({ error: "eventName is required" }, { status: 400 })
  }
  if (!city || typeof city !== "string" || !city.trim()) {
    return NextResponse.json({ error: "city is required" }, { status: 400 })
  }

  const cityName = city.trim()
  const venueName =
    venue && typeof venue === "string" && venue.trim() ? venue.trim() : null

  try {
    let cityLocation = await withRetry(() =>
      prisma.location.findFirst({
        where: {
          type: "CITY",
          OR: [
            { name: { equals: cityName, mode: "insensitive" } },
            { city: { equals: cityName, mode: "insensitive" } },
          ],
        },
      })
    )

    if (!cityLocation) {
      cityLocation = await withRetry(() =>
        prisma.location.create({
          data: { type: "CITY", name: cityName, city: cityName, active: true },
        })
      )
    }

    let locationId = cityLocation.id

    if (venueName) {
      let venueLocation = await withRetry(() =>
        prisma.location.findFirst({
          where: {
            type: "VENUE",
            parentId: cityLocation.id,
            name: { equals: venueName, mode: "insensitive" },
          },
        })
      )
      if (!venueLocation) {
        venueLocation = await withRetry(() =>
          prisma.location.create({
            data: {
              type: "VENUE",
              name: venueName,
              city: cityName,
              parentId: cityLocation.id,
              active: true,
            },
          })
        )
      }
      locationId = venueLocation.id
    }

    const startDate = eventDateStart ? new Date(String(eventDateStart)) : null
    const endDate   = eventDateEnd   ? new Date(String(eventDateEnd))   : null
    const validStatus = ["new", "reviewed", "contacted"].includes(
      String(status).toLowerCase().trim()
    )
      ? (String(status).toLowerCase().trim() as "new" | "reviewed" | "contacted")
      : ("new" as const)

    const event = await withRetry(() =>
      prisma.event.upsert({
        where: {
          locationId_eventName_eventDateStart: {
            locationId,
            eventName: eventName.trim(),
            eventDateStart: startDate ?? new Date("1900-01-01"),
          },
        },
        update: {
          eventName:       eventName.trim(),
          eventDateStart:  startDate,
          eventDateEnd:    endDate,
          organizerName:   organizerName   ? String(organizerName).trim()   : null,
          organizerTitle:  organizerTitle  ? String(organizerTitle).trim() : null,
          organizerEmail:  organizerEmail  ? String(organizerEmail).trim() : null,
          organizerPhone:  organizerPhone  ? String(organizerPhone).trim() : null,
          status:         validStatus,
          sourceUrl:      sourceUrl ? String(sourceUrl).trim() : null,
        },
        create: {
          locationId,
          eventName:      eventName.trim(),
          eventDateStart:  startDate,
          eventDateEnd:    endDate,
          organizerName:   organizerName   ? String(organizerName).trim()   : null,
          organizerTitle:  organizerTitle  ? String(organizerTitle).trim() : null,
          organizerEmail:  organizerEmail  ? String(organizerEmail).trim() : null,
          organizerPhone:  organizerPhone  ? String(organizerPhone).trim() : null,
          status:         validStatus,
          sourceUrl:      sourceUrl ? String(sourceUrl).trim() : null,
          dateAdded:      dateAdded ? new Date(String(dateAdded)) : new Date(),
        },
      })
    )

    return NextResponse.json({ eventId: event.id, created: true }, { status: 200 })
  } catch (err) {
    console.error("[/api/events/sync POST]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
