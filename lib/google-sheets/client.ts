import { createHmac, createSign } from "crypto"
import { readFileSync, existsSync } from "fs"
import { resolve } from "path"

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets"

function getCredentials() {
  const jsonStr = process.env.GOOGLE_SHEETS_CREDENTIALS_JSON
  if (jsonStr) {
    return JSON.parse(jsonStr)
  }
  const filePath = process.env.GOOGLE_SHEETS_CREDENTIALS
    ? resolve(process.cwd(), process.env.GOOGLE_SHEETS_CREDENTIALS)
    : resolve(process.cwd(), "credentials/google-sheets-service-account.json")
  if (!existsSync(filePath)) {
    throw new Error(`Credentials file not found at: ${filePath}`)
  }
  return JSON.parse(readFileSync(filePath, "utf8"))
}

async function getAccessToken(): Promise<string> {
  const creds = getCredentials()
  const now = Math.floor(Date.now() / 1000)

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({
      iss: creds.client_email,
      scope: SCOPES.join(" "),
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
    })
  ).toString("base64url")

  const signingInput = `${header}.${payload}`
  const signer = createSign("RSA-SHA256")
  signer.update(signingInput)
  const signature = signer.sign(creds.private_key, "base64url")

  const jwt = `${signingInput}.${signature}`

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })

  const data = (await res.json()) as { access_token?: string; error?: string }
  if (!data.access_token) {
    throw new Error(`Failed to get access token: ${data.error ?? res.statusText}`)
  }

  return data.access_token
}

export async function clearSheet(spreadsheetId: string, sheetName = "Sheet1"): Promise<void> {
  const token = await getAccessToken()
  const range = `${sheetName}!A1:Z`

  await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  })
}

export async function writeSheet(
  spreadsheetId: string,
  data: string[][],
  sheetName = "Sheet1"
): Promise<void> {
  const token = await getAccessToken()

  if (data.length === 0) return

  const range = `${sheetName}!A1:L${data.length + 1}`

  await fetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      values: data,
      range,
      majorDimension: "ROWS",
    }),
  })
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
