import { NextResponse } from "next/server"
import { getAllProviderStatus } from "@/lib/providers/credit-tracker"

export async function GET() {
  return NextResponse.json(getAllProviderStatus())
}
