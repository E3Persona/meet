"use client"

import React, { useState, useCallback, useEffect } from "react"
import { UniversalForm } from "@/components/ui/form/universal-form"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Trash2, Play } from "lucide-react"
import type { FormSection as FormSectionType } from "@/types/components"
import { toast } from "sonner"
import { ColumnDef } from "@tanstack/react-table"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Schedule {
  id: string
  name: string
  cronExpr: string
  locationIds: string[]
  templateIds: string[]
  sourceSiteIds: string[]
  active: boolean
  lastRunAt: string | null
  createdAt: string
}

interface Location { id: string; name: string }
interface Template { id: string; template: string }
interface SourceSite { id: string; name: string }

// ─── Cron presets ─────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: "Daily at 6 AM", value: "0 6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
  { label: "Every Monday 8 AM", value: "0 8 * * 1" },
  { label: "1st of month 6 AM", value: "0 6 1 * *" },
  { label: "Every 3 days 6 AM", value: "0 6 */3 * *" },
  { label: "Custom", value: "__custom__" },
]

// ─── Form sections ────────────────────────────────────────────────────────────

function buildFormSections(
  locations: Location[],
  templates: Template[],
  sourceSites: SourceSite[]
): FormSectionType[] {
  return [
    {
      id: "schedule-config",
      title: "Schedule Configuration",
      description: "Define when and what to run",
      columns: 4,
      fields: [
        {
          name: "name",
          label: "Schedule Name",
          type: "text",
          placeholder: "e.g. Daily Venue Scout",
          required: true,
          colSpan: 2,
        },
        {
          name: "cronPreset",
          label: "Frequency",
          type: "select",
          options: CRON_PRESETS.map((p) => ({ label: p.label, value: p.value })),
          colSpan: 2,
        },
        {
          name: "cronExpr",
          label: "Cron Expression",
          type: "text",
          placeholder: "0 6 * * *",
          helperText: "minute hour day month weekday",
          colSpan: 4,
        },
        {
          name: "locationIds",
          label: "Locations (leave empty for all)",
          type: "multi-select",
          options: locations.map((l) => ({ label: l.name, value: l.id })),
          colSpan: 4,
        },
        {
          name: "templateIds",
          label: "Search Templates (leave empty for all)",
          type: "multi-select",
          options: templates.map((t) => ({
            label: t.template.length > 50 ? t.template.slice(0, 50) + "..." : t.template,
            value: t.id,
          })),
          colSpan: 4,
        },
        {
          name: "sourceSiteIds",
          label: "Source Sites (leave empty for all)",
          type: "multi-select",
          options: sourceSites.map((s) => ({ label: s.name, value: s.id })),
          colSpan: 4,
        },
      ],
    },
  ]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ScheduleManager() {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [sourceSites, setSourceSites] = useState<SourceSite[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // ── Fetch all data ────────────────────────────────────────────────────────

  const fetchAll = useCallback(async () => {
    try {
      const [sRes, lRes, tRes, ssRes] = await Promise.all([
        fetch("/api/ingest/schedules"),
        fetch("/api/locations"),
        fetch("/api/search-templates"),
        fetch("/api/source-sites"),
      ])
      if (sRes.ok) setSchedules(await sRes.json())
      if (lRes.ok) setLocations(await lRes.json())
      if (tRes.ok) setTemplates(await tRes.json())
      if (ssRes.ok) setSourceSites(await ssRes.json())
    } catch {
      toast.error("Failed to load data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // ── Handle cron preset → fill cronExpr ─────────────────────────────────────

  useEffect(() => {
    const preset = formValues.cronPreset as string | undefined
    if (preset && preset !== "__custom__") {
      setFormValues((prev) => ({ ...prev, cronExpr: preset }))
    }
  }, [formValues.cronPreset])

  // ── Create schedule ────────────────────────────────────────────────────────

  const handleCreate = async (values: Record<string, unknown>) => {
    if (!values.name || !values.cronExpr) {
      setFormErrors({
        ...(!values.name ? { name: "Required" } : {}),
        ...(!values.cronExpr ? { cronExpr: "Required" } : {}),
      })
      return
    }
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/ingest/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          cronExpr: values.cronExpr,
          locationIds: (values.locationIds as string[]) ?? [],
          templateIds: (values.templateIds as string[]) ?? [],
          sourceSiteIds: (values.sourceSiteIds as string[]) ?? [],
        }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Schedule created")
      setFormValues({})
      setFormErrors({})
      fetchAll()
    } catch {
      toast.error("Failed to create schedule")
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────────

  const toggleSchedule = async (schedule: Schedule, active: boolean) => {
    await fetch(`/api/ingest/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    })
    fetchAll()
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  const deleteSchedule = async (schedule: Schedule) => {
    if (!confirm(`Delete schedule "${schedule.name}"?`)) return
    await fetch(`/api/ingest/schedules/${schedule.id}`, { method: "DELETE" })
    toast.success("Schedule deleted")
    fetchAll()
  }

  // ── Run now ────────────────────────────────────────────────────────────────

  const runNow = async (schedule: Schedule) => {
    toast.info(`Running "${schedule.name}"...`)
    try {
      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationIds: schedule.locationIds.length > 0 ? schedule.locationIds : undefined,
          templateIds: schedule.templateIds.length > 0 ? schedule.templateIds : undefined,
          sourceSiteIds: schedule.sourceSiteIds.length > 0 ? schedule.sourceSiteIds : undefined,
        }),
      })
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      toast.success(`Found ${data.recordsNew} new events`)
      fetchAll()
    } catch {
      toast.error("Run failed")
    }
  }

  // ── Resolve IDs to names for display ───────────────────────────────────────

  const resolveNames = (ids: string[], pool: { id: string; name: string; template?: string }[]) => {
    if (ids.length === 0) return "All"
    return ids
      .map((id) => pool.find((p) => p.id === id)?.name ?? pool.find((p) => p.id === id)?.template ?? id)
      .join(", ")
  }

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: ColumnDef<Schedule, unknown>[] = [
    {
      accessorKey: "name",
      header: "Schedule",
      cell: ({ row }) => {
        const s = row.original
        return (
          <div>
            <p className="font-medium text-sm">{s.name}</p>
            <p className="text-xs text-muted-foreground font-mono">{s.cronExpr}</p>
          </div>
        )
      },
    },
    {
      id: "targets",
      header: "Targets",
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p><span className="font-medium text-foreground">Locations:</span> {resolveNames(s.locationIds, locations)}</p>
            <p><span className="font-medium text-foreground">Templates:</span> {resolveNames(s.templateIds, templates.map(t => ({ ...t, name: t.template })))}</p>
            <p><span className="font-medium text-foreground">Sources:</span> {resolveNames(s.sourceSiteIds, sourceSites)}</p>
          </div>
        )
      },
    },
    {
      id: "lastRun",
      header: "Last Run",
      cell: ({ row }) => {
        const s = row.original
        return s.lastRunAt
          ? <span className="text-xs">{new Date(s.lastRunAt).toLocaleString()}</span>
          : <span className="text-xs text-muted-foreground">Never</span>
      },
    },
    {
      id: "active",
      header: "Active",
      meta: { align: "center" as const },
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className="flex justify-center">
            <Switch checked={s.active} onCheckedChange={(c) => toggleSchedule(s, c)} size="sm" />
          </div>
        )
      },
    },
  ]

  // ── Row actions ────────────────────────────────────────────────────────────

  const rowActions = (schedule: Schedule) => (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); runNow(schedule) }} title="Run now">
        <Play className="h-3.5 w-3.5" />
      </Button>
      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); deleteSchedule(schedule) }} title="Delete">
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  const sections = buildFormSections(locations, templates, sourceSites)

  return (
    <div className="space-y-6">
      <UniversalForm
        title="Add Schedule"
        description="Create a named cron schedule to run ingestion on specific locations, templates, or source sites"
        variant="standard"
        sections={sections}
        values={formValues}
        errors={formErrors}
        onChange={(name, value) => setFormValues((prev) => ({ ...prev, [name]: value }))}
        onSubmit={handleCreate}
        onCancel={() => { setFormValues({}); setFormErrors({}) }}
        isLoading={isSubmitting}
        primaryLabel="Create Schedule"
      />

      <Separator />

      <UniversalList
        columns={columns}
        data={schedules}
        getRowId={(row) => row.id}
        isLoading={loading}
        emptyMessage="No schedules configured. Create one above."
        ariaLabel="Ingestion schedules"
        rowActions={rowActions}
        searchPlaceholder="Search schedules..."
      />
    </div>
  )
}
