"use client"

import React, { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { StatsRow } from "@/components/dashboard/stats-row"
import { EventsTable } from "@/components/dashboard/events-table"
import { RunNowButton } from "@/components/dashboard/run-now-button"
import { RunHistoryTable } from "@/components/dashboard/run-history-table"
import { LocationsManager } from "@/components/locations/locations-manager"

export default function DashboardPage() {
  const [tab, setTab] = useState("events")
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = () => setRefreshKey((k) => k + 1)

  return (
    <div className="min-h-screen p-6">
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
        <StatsRow key={refreshKey} />

        {/* Main Content Tabs */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="events" count={undefined}>
              Events
            </TabsTrigger>
            <TabsTrigger value="locations">Locations & Search Terms</TabsTrigger>
            <TabsTrigger value="runs">Run History</TabsTrigger>
          </TabsList>

          <TabsContent value="events" className="mt-4">
            <EventsTable key={refreshKey} />
          </TabsContent>

          <TabsContent value="locations" className="mt-4">
            <LocationsManager />
          </TabsContent>

          <TabsContent value="runs" className="mt-4">
            <RunHistoryTable />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
