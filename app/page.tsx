"use client"

import React, { useState, useEffect } from "react"
import { StatsRow } from "@/components/dashboard/stats-row"
import { EventsTable } from "@/components/dashboard/events-table"
import { RunNowButton } from "@/components/dashboard/run-now-button"
import { RunHistoryTable } from "@/components/dashboard/run-history-table"
import { LocationsManager } from "@/components/locations/locations-manager"
import { TemplatesManager } from "@/components/templates/templates-manager"
import { SourceSitesManager } from "@/components/source-sites/source-sites-manager"
import { DirectoriesManager } from "@/components/directories/directories-manager"
import { ScrapersPanel } from "@/components/dashboard/scrapers-panel"
import { ScheduleManager } from "@/components/schedules/schedule-manager"
import { Sidebar, type SidebarSection } from "@/components/dashboard/sidebar"

const SECTION_TITLES: Record<
  SidebarSection,
  { title: string; description: string }
> = {
  events: {
    title: "e3 Event Intelligence Dashboard",
    description: "Sales pipeline for tracking meetings, conventions, and tradeshows across venues.",
  },
  locations: {
    title: "Locations",
    description: "Manage venues and their search configurations.",
  },
  templates: {
    title: "Search Templates",
    description:
      "Define query templates expanded per-location at ingestion time.",
  },
  sources: {
    title: "Source Sites",
    description: "Event directories and websites to scrape during ingestion.",
  },
  directories: {
    title: "Directories",
    description:
      "Configure CSS selectors for deterministic event extraction from directory sites.",
  },
  scrapers: {
    title: "Site Scrapers",
    description:
      "Run per-site scrapers (Puppeteer-based) for dedicated conference directories.",
  },
  schedules: {
    title: "Schedules",
    description: "Configure named cron schedules for automated ingestion runs.",
  },
  runs: {
    title: "Run History",
    description: "View all past ingestion runs and their results.",
  },
}

export default function DashboardPage() {
  const [active, setActive] = useState<SidebarSection>("events")
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    const saved = localStorage.getItem("dashboard-active-section")
    if (saved && saved in SECTION_TITLES) setActive(saved as SidebarSection)
  }, [])

  const handleSetActive = (section: SidebarSection) => {
    setActive(section)
    localStorage.setItem("dashboard-active-section", section)
  }

  const refresh = () => setRefreshKey((k) => k + 1)
  const section = SECTION_TITLES[active]

  return (
    <>
      <Sidebar active={active} onSelect={handleSetActive} />

      <main className="flex-1 md:ml-60">
        <div className="p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  {section.title}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {section.description}
                </p>
              </div>
              {active === "events" && <RunNowButton onComplete={refresh} />}
            </div>

            {/* Stats — events view only */}
            {active === "events" && <StatsRow />}

            {/* Content */}
            {active === "events" && <EventsTable key={refreshKey} />}
            {active === "locations" && <LocationsManager />}
            {active === "templates" && <TemplatesManager />}
            {active === "sources" && <SourceSitesManager />}
            {active === "directories" && <DirectoriesManager />}
            {active === "scrapers" && <ScrapersPanel />}
            {active === "schedules" && <ScheduleManager />}
            {active === "runs" && <RunHistoryTable />}
          </div>
        </div>
      </main>
    </>
  )
}
