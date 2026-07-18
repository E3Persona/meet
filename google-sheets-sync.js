/**
 * Google Sheets ↔ Database Sync
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this entire file into the editor (replace everything)
 * 3. Save (Ctrl+S)
 * 4. Set CONFIG values below (API_KEY and SHEET_WEBHOOK_URL)
 * 5. Run onOpen() once manually: click ▸ Event Sync → Setup Sheet Columns
 *    (this writes the header row so you never have to set them manually)
 *
 * HOW IT WORKS:
 * - "Push to Sheet" button in the dashboard → calls /api/events/export-sheet
 *   → posts to this script → script writes ALL events to the sheet (header + data)
 * - Every time you add/edit a row in the sheet → onEdit fires → row syncs to DB
 *   (no cron needed — edits trigger instantly)
 */

const CONFIG = {
  API_KEY:           "e3e-v1-gs-sync-key-2025", // Must match GOOGLE_SHEETS_SYNC_API_KEY in .env
  SHEET_WEBHOOK_URL: "https://e3evint.e3personnel.com/api/events/sync", // Your app sync endpoint
  SHEET_NAME:        "Sheet1",
  HEADER_ROW:        1,
};

// ─── Column mapping (1-indexed) ────────────────────────────────────────────────
const COL = {
  EVENT_NAME:      1,  // A
  START_DATE:      2,  // B
  END_DATE:       3,  // C
  CITY:           4,  // D
  VENUE:          5,  // E
  ORGANIZER_NAME:  6,  // F
  ORGANIZER_TITLE: 7,  // G
  ORGANIZER_EMAIL: 8,  // H
  ORGANIZER_PHONE: 9,  // I
  STATUS:         10, // J
  SOURCE_URL:     11, // K
  DATE_ADDED:     12, // L
};

const HEADERS = [
  "Event Name", "Start Date", "End Date", "City", "Venue",
  "Organizer Name", "Organizer Title", "Organizer Email",
  "Organizer Phone", "Status", "Source URL", "Date Added",
];

const VALID_STATUSES = ["new", "reviewed", "contacted"];

// ─── Sheet → DB: fires on every cell edit ─────────────────────────────────────

function onEdit(e) {
  if (!e || !e.range) return
  const range = e.range
  if (range.getRow() <= CONFIG.HEADER_ROW) return
  if (range.getSheet().getName() !== CONFIG.SHEET_NAME) return
  syncRowToDb(range.getRow())
}

function syncRowToDb(rowNum) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME)
  if (!sheet) return

  const eventName  = sheet.getRange(rowNum, COL.EVENT_NAME).getValue()
  const startDate = sheet.getRange(rowNum, COL.START_DATE).getValue()
  const endDate   = sheet.getRange(rowNum, COL.END_DATE).getValue()
  const city      = sheet.getRange(rowNum, COL.CITY).getValue()
  const venue     = sheet.getRange(rowNum, COL.VENUE).getValue()
  const orgName   = sheet.getRange(rowNum, COL.ORGANIZER_NAME).getValue()
  const orgTitle  = sheet.getRange(rowNum, COL.ORGANIZER_TITLE).getValue()
  const orgEmail  = sheet.getRange(rowNum, COL.ORGANIZER_EMAIL).getValue()
  const orgPhone  = sheet.getRange(rowNum, COL.ORGANIZER_PHONE).getValue()
  const status    = sheet.getRange(rowNum, COL.STATUS).getValue()
  const sourceUrl = sheet.getRange(rowNum, COL.SOURCE_URL).getValue()
  const dateAdded = sheet.getRange(rowNum, COL.DATE_ADDED).getValue()

  if (!eventName || String(eventName).trim() === "") return

  const payload = {
    eventName:      String(eventName).trim(),
    eventDateStart: startDate ? parseDate(startDate) : null,
    eventDateEnd:  endDate   ? parseDate(endDate)   : null,
    city:          city      ? String(city).trim()  : null,
    venue:         venue     ? String(venue).trim() : null,
    organizerName:  orgName   ? String(orgName).trim()  : null,
    organizerTitle: orgTitle  ? String(orgTitle).trim() : null,
    organizerEmail:orgEmail  ? String(orgEmail).trim() : null,
    organizerPhone: orgPhone  ? String(orgPhone).trim() : null,
    status: VALID_STATUSES.includes(String(status || "new").toLowerCase().trim())
      ? String(status).toLowerCase().trim()
      : "new",
    sourceUrl:  sourceUrl ? String(sourceUrl).trim() : null,
    dateAdded: dateAdded ? parseDate(dateAdded) : null,
  }

  try {
    UrlFetchApp.fetch(CONFIG.SHEET_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      headers: {
        Authorization: `Bearer ${CONFIG.API_KEY}`,
        Accept: "application/json",
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    })
  } catch (err) {
    console.error(`Row ${rowNum} sync error:`, err.message)
  }
}

// ─── DB → Sheet: receives rows from dashboard's "Push to Sheet" ────────────────

function doPost(e) {
  let data
  try {
    data = JSON.parse(e.postData.contents)
  } catch {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Invalid JSON" }))
      .setMimeType(ContentService.MimeType.JSON)
  }

  const rows = data.rows || []

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME)
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Sheet not found" }))
      .setMimeType(ContentService.MimeType.JSON)
  }

  // Clear existing data rows (keep header)
  if (sheet.getLastRow() > CONFIG.HEADER_ROW) {
    sheet.deleteRows(CONFIG.HEADER_ROW + 1, sheet.getLastRow() - CONFIG.HEADER_ROW)
  }

  // Ensure header row is set up
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length)
  headerRange
    .setFontWeight("bold")
    .setBackground("#e5e7eb")
    .setHorizontalAlignment("center")

  // Freeze header row
  sheet.setFrozenRows(CONFIG.HEADER_ROW)

  // If no rows to write, we're done
  if (rows.length === 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ synced: 0 }))
      .setMimeType(ContentService.MimeType.JSON)
  }

  // Write data rows
  const values = rows.map((row) => [
    row[0]  ?? "",  // eventName
    row[1]  ?? "",  // startDate
    row[2]  ?? "",  // endDate
    row[3]  ?? "",  // city
    row[4]  ?? "",  // venue
    row[5]  ?? "",  // organizerName
    row[6]  ?? "",  // organizerTitle
    row[7]  ?? "",  // organizerEmail
    row[8]  ?? "",  // organizerPhone
    row[9]  ?? "new", // status
    row[10] ?? "",  // sourceUrl
    row[11] ?? "",  // dateAdded
  ])

  sheet.getRange(CONFIG.HEADER_ROW + 1, 1, values.length, HEADERS.length)
    .setValues(values)

  // Auto-resize columns
  const dataRange = sheet.getRange(1, 1, Math.min(rows.length + 1, 100), HEADERS.length)
  sheet.autoResizeColumns(dataRange)

  return ContentService
    .createTextOutput(JSON.stringify({ synced: rows.length }))
    .setMimeType(ContentService.MimeType.JSON)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().split("T")[0]
  const parsed = new Date(String(value))
  if (isNaN(parsed.getTime())) return null
  return parsed.toISOString().split("T")[0]
}

// ─── Menu ──────────────────────────────────────────────────────────────────────

function onOpen() {
  const ui = SpreadsheetApp.getUi()
  ui.createMenu("▸ Event Sync")
    .addItem("Setup Sheet Columns", "setupSheetColumns")
    .addItem("Sync All Rows to DB", "syncAllRows")
    .addToUi()
}

function setupSheetColumns() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME)
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`Sheet "${CONFIG.SHEET_NAME}" not found.`)
    return
  }
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS])
  const headerRange = sheet.getRange(1, 1, 1, HEADERS.length)
  headerRange
    .setFontWeight("bold")
    .setBackground("#e5e7eb")
    .setHorizontalAlignment("center")
  sheet.setFrozenRows(CONFIG.HEADER_ROW)
  SpreadsheetApp.getActiveSpreadsheet().toast("Columns set up! Headers written to row 1.")
}

function syncAllRows() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME)
  if (!sheet) return
  const lastRow = sheet.getLastRow()
  let synced = 0
  for (let row = CONFIG.HEADER_ROW + 1; row <= lastRow; row++) {
    const eventName = sheet.getRange(row, COL.EVENT_NAME).getValue()
    if (eventName && String(eventName).trim() !== "") {
      syncRowToDb(row)
      synced++
    }
  }
  SpreadsheetApp.getActiveSpreadsheet().toast(`Synced ${synced} rows to DB.`)
}
