"use client"

import React, { useState, useEffect, useMemo } from "react"
import { MetricCardsGrid } from "@/components/ui/analytics/metric-cards-grid"
import { MapPin, Calendar, Sparkles, Activity, Search, Globe } from "lucide-react"
import type { MetricCardDef } from "@/types/components"

interface Stats {
  totalLocations: number
  totalEvents: number
  newThisWeek: number
  totalTemplates: number
  totalSourceSites: number
  lastRun: {
    status: string
    startedAt: string
    recordsFound: number
    recordsNew: number
    trigger: string
  } | null
}

function formatWeekRange(now: Date): string {
  const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000)
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return `${fmt(start)} – ${fmt(now)}`
}

function formatRunDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function StatsRow() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {})
  }, [])

  const weekRange = useMemo(
    () => formatWeekRange(new Date()),
    []
  )

  const lastRunLabel = stats?.lastRun
    ? `${stats.lastRun.status === "success" ? "Success" : stats.lastRun.status === "failed" ? "Failed" : "Running"} (${stats.lastRun.recordsNew} new)`
    : "No runs yet"

  const lastRunDate = stats?.lastRun?.startedAt
    ? formatRunDate(stats.lastRun.startedAt)
    : ""

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
      comparisonLabel: weekRange,
    },
    {
      id: "templates",
      label: "Search Templates",
      value: stats?.totalTemplates ?? 0,
      icon: Search,
      accent: "info",
    },
    {
      id: "source-sites",
      label: "Source Sites",
      value: stats?.totalSourceSites ?? 0,
      icon: Globe,
      accent: "info",
    },
    {
      id: "last-run",
      label: "Last Run",
      value: lastRunLabel,
      icon: Activity,
      accent: stats?.lastRun?.status === "failed" ? "danger" : "success",
      comparisonLabel: lastRunDate || undefined,
    },
  ]

  return <MetricCardsGrid cards={cards} columns={3} />
}
