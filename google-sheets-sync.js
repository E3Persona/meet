/**
 * Google Sheets ↔ Database Sync
 *
 * SETUP:
 * 1. Open your Google Sheet → Extensions → Apps Script
 * 2. Paste this entire file into the editor (replace everything)
 * 3. Save (Ctrl+S)
 * 4. Click the clock icon (Triggers) → Add trigger → doPost | Time-driven | Every minute
 * 5. Set CONFIG values below (API_KEY and SHEET_WEBHOOK_URL)
 *
 * TWO-WAY SYNC:
 * - Sheet → DB : onEdit() fires on every cell change, checks if a row has
 *                Event Name, then POSTs it to /api/events/sync
 * - DB → Sheet : "Push to Sheet" in the dashboard calls /api/events/export-sheet,
 *                which POSTs to this script's doPost() → writes all rows to the sheet
 */

const CONFIG = {
  API_KEY:          "e3e-v1-gs-sync-key-2025", // Must match GOOGLE_SHEETS_SYNC_API_KEY in .env
  SHEET_WEBHOOK_URL:"https://e3evint.e3personnel.com/api/events/sync", // Your app's sync endpoint
  SHEET_NAME:       "Sheet1",
  HEADER_ROW:       1,
  ID_COL:           14, // Column N: DB event ID (written after first push, used for updates)
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
  DB_ID:          14, // N  ← internal, not a real column
};

const VALID_STATUSES = ["new", "reviewed", "contacted"];

// ─── Sheet → DB: onEdit ────────────────────────────────────────────────────────

function onEdit(e) {
  const range = e.range;
  if (range.getRow() <= CONFIG.HEADER_ROW) return;
  if (range.getSheet().getName() !== CONFIG.SHEET_NAME) return;
  syncRowToDb(range.getRow());
}

// Catch-all: run every minute in case onEdit missed something
function triggerSyncAll() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;
  const lastRow = sheet.getLastRow();
  for (let row = CONFIG.HEADER_ROW + 1; row <= lastRow; row++) {
    const eventName = sheet.getRange(row, COL.EVENT_NAME).getValue();
    if (eventName && String(eventName).trim() !== "") {
      syncRowToDb(row);
    }
  }
}

function syncRowToDb(rowNum) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) return;

  const eventName   = sheet.getRange(rowNum, COL.EVENT_NAME).getValue();
  const startDate   = sheet.getRange(rowNum, COL.START_DATE).getValue();
  const endDate     = sheet.getRange(rowNum, COL.END_DATE).getValue();
  const city        = sheet.getRange(rowNum, COL.CITY).getValue();
  const venue       = sheet.getRange(rowNum, COL.VENUE).getValue();
  const orgName     = sheet.getRange(rowNum, COL.ORGANIZER_NAME).getValue();
  const orgTitle    = sheet.getRange(rowNum, COL.ORGANIZER_TITLE).getValue();
  const orgEmail    = sheet.getRange(rowNum, COL.ORGANIZER_EMAIL).getValue();
  const orgPhone    = sheet.getRange(rowNum, COL.ORGANIZER_PHONE).getValue();
  const status      = sheet.getRange(rowNum, COL.STATUS).getValue();
  const sourceUrl   = sheet.getRange(rowNum, COL.SOURCE_URL).getValue();
  const dateAdded   = sheet.getRange(rowNum, COL.DATE_ADDED).getValue();

  if (!eventName || String(eventName).trim() === "") return;

  const payload = {
    eventName:       String(eventName).trim(),
    eventDateStart:  startDate ? parseDate(startDate) : null,
    eventDateEnd:   endDate   ? parseDate(endDate)   : null,
    city:           city      ? String(city).trim()  : null,
    venue:          venue     ? String(venue).trim() : null,
    organizerName:   orgName   ? String(orgName).trim()  : null,
    organizerTitle:  orgTitle  ? String(orgTitle).trim() : null,
    organizerEmail:  orgEmail  ? String(orgEmail).trim() : null,
    organizerPhone:  orgPhone  ? String(orgPhone).trim() : null,
    status:         VALID_STATUSES.includes(String(status || "new").toLowerCase().trim())
                      ? String(status).toLowerCase().trim()
                      : "new",
    sourceUrl:      sourceUrl ? String(sourceUrl).trim() : null,
    dateAdded:      dateAdded ? parseDate(dateAdded)   : null,
  };

  try {
    const response = UrlFetchApp.fetch(CONFIG.SHEET_WEBHOOK_URL, {
      method: "post",
      contentType: "application/json",
      headers: {
        "Authorization": `Bearer ${CONFIG.API_KEY}`,
        "Accept": "application/json",
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const json = JSON.parse(response.getContentText());

    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
      // Write back the DB event ID if returned
      if (json.eventId) {
        sheet.getRange(rowNum, COL.DB_ID).setValue(json.eventId);
      }
      sheet.getRange(rowNum, COL.DB_ID).setValue(
        sheet.getRange(rowNum, COL.DB_ID).getValue() || (json.eventId || "Synced")
      );
    }
  } catch (err) {
    console.error(`Row ${rowNum} sync error:`, err.message);
  }
}

// ─── DB → Sheet: receives rows from dashboard's "Push to Sheet" ────────────────

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "Invalid JSON" }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const rows = data.rows || [];

  if (rows.length === 0) {
    return ContentService
      .createTextOutput(JSON.stringify({ synced: 0 }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);

  // Clear existing data (keep header row)
  if (sheet.getLastRow() > CONFIG.HEADER_ROW) {
    sheet.deleteRows(CONFIG.HEADER_ROW + 1, sheet.getLastRow() - CONFIG.HEADER_ROW);
  }

  // Write header row if sheet is empty
  if (sheet.getLastRow() < CONFIG.HEADER_ROW) {
    const headers = [
      "Event Name", "Start Date", "End Date", "City", "Venue",
      "Organizer Name", "Organizer Title", "Organizer Email",
      "Organizer Phone", "Status", "Source URL", "Date Added", "", "DB Event ID",
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight("bold")
      .setBackground("#f3f4f6");
  }

  // Append all rows
  const values = rows.map((row) => [
    row[0]  ?? "", // eventName
    row[1]  ?? "", // startDate
    row[2]  ?? "", // endDate
    row[3]  ?? "", // city
    row[4]  ?? "", // venue
    row[5]  ?? "", // organizerName
    row[6]  ?? "", // organizerTitle
    row[7]  ?? "", // organizerEmail
    row[8]  ?? "", // organizerPhone
    row[9]  ?? "new", // status
    row[10] ?? "", // sourceUrl
    row[11] ?? "", // dateAdded
    "",          // col M spacer
    row[12] ?? "", // dbId
  ]);

  sheet.getRange(CONFIG.HEADER_ROW + 1, 1, values.length, values[0].length)
    .setValues(values);

  // Auto-resize columns
  const headersRange = sheet.getRange(1, 1, 1, values[0].length);
  sheet.autoResizeColumns(headersRange);

  return ContentService
    .createTextOutput(JSON.stringify({ synced: rows.length }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return value.toISOString().split("T")[0];
  }
  const parsed = new Date(String(value));
  if (isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split("T")[0];
}

// ─── Menu ──────────────────────────────────────────────────────────────────────

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("▸ Event Sync")
    .addItem("Sync all rows to DB", "triggerSyncAll")
    .addToUi();
}
