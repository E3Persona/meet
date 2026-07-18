import { google } from "googleapis"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"

const SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

export function getSheetsClient() {
  let credentials: Record<string, unknown>

  const jsonStr = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON
  if (jsonStr) {
    credentials = JSON.parse(jsonStr)
  } else {
    const filePath = process.env.GOOGLE_SHEETS_CREDENTIALS
      ? resolve(process.cwd(), process.env.GOOGLE_SHEETS_CREDENTIALS)
      : resolve(process.cwd(), "credentials/google-sheets-service-account.json")

    if (!existsSync(filePath)) {
      throw new Error(
        `Google Sheets credentials file not found at: ${filePath}\n` +
        `Set GOOGLE_SHEETS_CREDENTIALS_JSON as an environment variable with the ` +
        `full service account JSON string, or ensure the JSON file exists at the path above.`
      )
    }
    credentials = JSON.parse(readFileSync(filePath, "utf8"))
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SHEETS_SCOPES,
  })

  return google.sheets({ version: "v4", auth })
}

export const HEADERS = [
  "Event Name",
  "Start Date",
  "End Date",
  "City",
  "Venue",
  "Organizer Name",
  "Organizer Title",
  "Organizer Email",
  "Organizer Phone",
  "Status",
  "Source URL",
  "Date Added",
]
