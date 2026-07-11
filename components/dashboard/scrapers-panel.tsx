"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Play, Globe } from "lucide-react"

interface ScraperDef {
  id: string
  name: string
  site: string
  apiPath: string
  description: string
  tech: "puppeteer" | "fetch"
}

const SCRAPERS: ScraperDef[] = [
  {
    id: "ica",
    name: "ICA",
    site: "internationalconferencealerts.com",
    apiPath: "/api/ingest/ica",
    description: "Conference listings from International Conference Alerts",
    tech: "puppeteer",
  },
  {
    id: "cn",
    name: "ConferenceNext",
    site: "conferencenext.com",
    apiPath: "/api/ingest/cn",
    description: "Conference listings from ConferenceNext",
    tech: "puppeteer",
  },
  {
    id: "aca",
    name: "AllConferenceAlert",
    site: "allconferencealert.net",
    apiPath: "/api/ingest/aca",
    description: "Conference listings from All Conference Alert",
    tech: "puppeteer",
  },
  {
    id: "tf",
    name: "Tradefest",
    site: "tradefest.io",
    apiPath: "/api/ingest/tf",
    description: "Ranked trade show listings from Tradefest",
    tech: "puppeteer",
  },
  {
    id: "showsbee",
    name: "Showsbee",
    site: "showsbee.com",
    apiPath: "/api/ingest/showsbee",
    description: "Trade show listings from Showsbee",
    tech: "puppeteer",
  },
  {
    id: "eventseye",
    name: "Eventseye",
    site: "eventseye.com",
    apiPath: "/api/ingest/eventseye",
    description: "Trade fair listings from Eventseye",
    tech: "puppeteer",
  },
  {
    id: "asae",
    name: "ASAE",
    site: "asaecenter.org",
    apiPath: "/api/ingest/asae",
    description: "Association events from ASAE (PheedLoop embed, Puppeteer)",
    tech: "puppeteer",
  },
  {
    id: "blackmeetings",
    name: "Black Meetings",
    site: "blackmeetingsandtourism.com",
    apiPath: "/api/ingest/blackmeetings",
    description: "Events and venues from Black Meetings & Tourism magazine",
    tech: "fetch",
  },
  {
    id: "thetradeshowcalendar",
    name: "Trade Show Calendar",
    site: "thetradeshowcalendar.com",
    apiPath: "/api/ingest/thetradeshowcalendar",
    description: "Trade show listings via Exhibit City News (DC/PHL/BAL regions)",
    tech: "puppeteer",
  },
  {
    id: "sgmp",
    name: "SGMP",
    site: "sgmp.org",
    apiPath: "/api/ingest/sgmp",
    description: "Government meeting events from SGMP calendar",
    tech: "puppeteer",
  },
  {
    id: "infosec",
    name: "InfoSec Conferences",
    site: "infosec-conferences.com",
    apiPath: "/api/ingest/infosec",
    description: "Cybersecurity conferences from infosec-conferences.com",
    tech: "fetch",
  },
]

export function ScrapersPanel() {
  const [running, setRunning] = useState<string | null>(null)

  const handleRun = async (scraper: ScraperDef) => {
    setRunning(scraper.id)
    toast.info(`${scraper.name} ingestion started (test: 1 location)...`)

    try {
      const res = await fetch(scraper.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxLocations: 1 }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? `${scraper.name} failed`)
        return
      }

      toast.success(`${scraper.name} started in background — check Run History for results`)
    } catch {
      toast.error(`${scraper.name} request failed`)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {SCRAPERS.map((scraper) => {
        const isRunning = running === scraper.id
        return (
          <Card key={scraper.id} size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{scraper.name}</CardTitle>
                <Badge variant="info" dot>
                  {scraper.tech === "puppeteer" ? "Puppeteer" : "HTTP"}
                </Badge>
              </div>
              <CardDescription>{scraper.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Globe className="h-3 w-3" />
                {scraper.site}
              </div>
              <Button
                onClick={() => handleRun(scraper)}
                loading={isRunning}
                leftIcon={Play}
                className="w-full"
              >
                {isRunning ? "Running..." : "Run Now"}
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
