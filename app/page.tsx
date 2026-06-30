"use client"

import React, { useState } from "react"
import { StatsRow } from "@/components/dashboard/stats-row"
import { EventsTable } from "@/components/dashboard/events-table"
import { RunNowButton } from "@/components/dashboard/run-now-button"
import { RunHistoryTable } from "@/components/dashboard/run-history-table"
import { LocationsManager } from "@/components/locations/locations-manager"
import { TemplatesManager } from "@/components/templates/templates-manager"
import { SourceSitesManager } from "@/components/source-sites/source-sites-manager"
import { ScheduleManager } from "@/components/schedules/schedule-manager"
import { Sidebar, type SidebarSection } from "@/components/dashboard/sidebar"

export default function DashboardPage() {
  const [active, setActive] = useState<SidebarSection>("events")
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => setRefreshKey((k) => k + 1)

  return (
    <>
      <Sidebar active={active} onSelect={setActive} />

      {/* Main content — offset by sidebar width */}
      <main className="flex-1 md:ml-60">
        <div className="p-6">
          <div className="mx-auto max-w-7xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Event Pipeline Dashboard
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                  Track meetings, conventions, and tradeshows across venues.
                </p>
              </div>
              <RunNowButton onComplete={refresh} />
            </div>

            {/* Stats */}
            <StatsRow />

            {/* Content */}
            {active === "events" && <EventsTable key={refreshKey} />}
            {active === "locations" && <LocationsManager />}
            {active === "templates" && <TemplatesManager />}
            {active === "sources" && <SourceSitesManager />}
            {active === "schedules" && <ScheduleManager />}
            {active === "runs" && <RunHistoryTable />}
          </div>
        </div>
      </main>
    </>
  )
}
