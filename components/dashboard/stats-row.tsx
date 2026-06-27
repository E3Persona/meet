"use client"

import React, { useState, useEffect } from "react"
import { MetricCardsGrid } from "@/components/ui/analytics/metric-cards-grid"
import { MapPin, Calendar, Sparkles, Activity } from "lucide-react"
import type { MetricCardDef } from "@/types/components"

interface Stats {
  totalLocations: number
  totalEvents: number
  newThisWeek: number
  lastRun: {
    status: string
    startedAt: string
    recordsFound: number
    recordsNew: number
    trigger: string
  } | null
}

export function StatsRow() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
  }, [])

  const lastRunLabel = stats?.lastRun
    ? `${stats.lastRun.status === "success" ? "Success" : stats.lastRun.status === "failed" ? "Failed" : "Running"} (${stats.lastRun.recordsNew} new)`
    : "No runs yet"

  const cards: MetricCardDef[] = [
    {
      id: "locations",
      label: "Total Locations",
      value: stats?.totalLocations ?? 0,
      icon: MapPin,
      accent: "primary",
    },
    {
      id: "events",
      label: "Total Events",
      value: stats?.totalEvents ?? 0,
      icon: Calendar,
      accent: "info",
    },
    {
      id: "new-week",
      label: "New This Week",
      value: stats?.newThisWeek ?? 0,
      icon: Sparkles,
      accent: "success",
    },
    {
      id: "last-run",
      label: "Last Run",
      value: lastRunLabel,
      icon: Activity,
      accent: stats?.lastRun?.status === "failed" ? "danger" : "success",
    },
  ]

  return <MetricCardsGrid cards={cards} columns={4} />
}
