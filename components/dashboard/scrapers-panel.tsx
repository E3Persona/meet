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
    {
      id: "tradefairdates",
      name: "TradeFairDates",
      site: "tradefairdates.com",
      apiPath: "/api/ingest/tradefairdates",
      description: "773 US trade fairs — paginated listing with contact enrichment",
      tech: "fetch",
    },
    {
      id: "eventsdc",
      name: "EventsDC",
      site: "eventsdc.com",
      apiPath: "/api/ingest/eventsdc",
      description: "Events at Walter E. Washington Convention Center (Washington DC)",
      tech: "puppeteer",
    },
    {
      id: "gaylordnational",
      name: "Gaylord National",
      site: "tickets.gaylordnational.com",
      apiPath: "/api/ingest/gaylordnational",
      description: "Events at Gaylord National Resort & Convention Center (National Harbor, MD)",
      tech: "puppeteer",
    },
    {
      id: "rrbitc",
      name: "RRBITC",
      site: "rrbitc.com",
      apiPath: "/api/ingest/rrbitc",
      description: "Events at the Ronald Reagan Building & International Trade Center (DC)",
      tech: "fetch",
    },
    {
      id: "philadelphiaunion",
      name: "Philadelphia Union",
      site: "philadelphiaunion.com",
      apiPath: "/api/ingest/philadelphiaunion",
      description: "Non-Union events at Subaru Park via image OCR (Wrexham, PLL, Breakaway, USWNT)",
      tech: "fetch",
    },
    {
      id: "generic-llm",
      name: "Generic LLM Scraper",
      site: "All source sites (no dedicated scraper)",
      apiPath: "/api/ingest/generic-llm",
      description: "Scrape all active source sites without dedicated scrapers via LLM API server",
      tech: "fetch",
    },
    {
      id: "eventbrite",
      name: "Eventbrite",
      site: "eventbrite.com",
      apiPath: "/api/ingest/eventbrite",
      description: "Puppeteer-based search per city using Eventbrite SERP data",
      tech: "puppeteer",
    },
    {
      id: "eventbrite-api",
      name: "Eventbrite API",
      site: "api.eventbrite.com",
      apiPath: "/api/ingest/eventbrite-api",
      description: "Eventbrite internal v3 API — enrich + discover via collections",
      tech: "fetch",
    },
    {
      id: "webmobi",
      name: "Webmobi Discovery",
      site: "webmobi.com",
      apiPath: "/api/ingest/webmobi",
      description: "US events from webmobi.com discovery API (plain fetch)",
      tech: "fetch",
    },
    {
      id: "bigevent",
      name: "BigEvent",
      site: "bigevent.io",
      apiPath: "/api/ingest/bigevent",
      description: "Global events directory from BigEvent.io (Puppeteer+stealth)",
      tech: "puppeteer",
    },
    {
      id: "marriott",
      name: "Marriott Events",
      site: "event.marriott.com",
      apiPath: "/api/ingest/marriott",
      description: "Events at Marriott Marquis Washington DC via API",
      tech: "fetch",
    },
    {
      id: "phillyexpocenter",
      name: "Philly Expo Center",
      site: "phillyexpocenter.com",
      apiPath: "/api/ingest/phillyexpocenter",
      description: "Events at Greater Philadelphia Expo Center at Oaks",
      tech: "puppeteer",
    },
    {
      id: "venues",
      name: "Venue Directories",
      site: "Venue listing pages",
      apiPath: "/api/ingest/run",
      description: "Scrapes venue directory pages (paconvention.com, etc.) for events",
      tech: "fetch",
    },
  ]

export function ScrapersPanel() {
  const [running, setRunning] = useState<string | null>(null)

  const handleRun = async (scraper: ScraperDef) => {
    setRunning(scraper.id)
    toast.info(`${scraper.name} ingestion started...`)

    const body = scraper.id === "venues"
      ? { scraperTypes: ["venues"] }
      : { maxLocations: 1 }

    try {
      const res = await fetch(scraper.apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
