"use client"

import React, { useState, useCallback, useEffect } from "react"
import { UniversalForm } from "@/components/ui/form/universal-form"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Trash2, Plus, Play, Clock } from "lucide-react"
import type { FormSection as FormSectionType } from "@/types/components"
import { toast } from "sonner"
import { ColumnDef } from "@tanstack/react-table"

interface SourceSite {
  id: string
  name: string
  url: string | null
  active: boolean
  sourceMode: "automated" | "manual"
  urlPattern: string | null
  scrapeMode: string
  notes: string | null
  lastScrapedAt: string | null
  lastScrapeStatus: string | null
  manualCheckFrequencyDays: number | null
  lastManualCheckAt: string | null
  eventsFound: number
}

const SOURCE_SITE_FORM_SECTIONS: FormSectionType[] = [
  {
    id: "details",
    title: "Source Site Details",
    description: "Add event directories and websites to check during ingestion.",
    columns: 4,
    fields: [
      {
        name: "name",
        label: "Site Name",
        type: "text",
        placeholder: "e.g. 10times.com",
        required: true,
        colSpan: 2,
      },
      {
        name: "url",
        label: "Base URL",
        type: "text",
        placeholder: "https://...",
        colSpan: 2,
      },
      {
        name: "sourceMode",
        label: "Source Mode",
        type: "select",
        options: [
          { label: "Automated (scraped programmatically)", value: "automated" },
          { label: "Manual (human review required)", value: "manual" },
        ],
        colSpan: 2,
      },
      {
        name: "manualCheckFrequencyDays",
        label: "Check Every (days)",
        type: "number",
        placeholder: "14",
        helperText: "Only for manual sources — how often to remind for review",
        colSpan: 2,
      },
      {
        name: "scrapeMode",
        label: "Scrape Mode",
        type: "select",
        options: [
          { label: "Auto", value: "auto" },
          { label: "Calendar", value: "calendar" },
          { label: "Directory", value: "directory" },
          { label: "Search", value: "search" },
          { label: "Skip", value: "skip" },
        ],
        colSpan: 2,
      },
      {
        name: "urlPattern",
        label: "URL Pattern (regex)",
        type: "text",
        placeholder: "e.g. 10times\\.com",
        helperText: "Used to skip known sources during Phase 2 search",
        colSpan: 2,
      },
      {
        name: "notes",
        label: "Scraping Notes",
        type: "textarea",
        placeholder: "LLM instructions for this site...",
        helperText: "Injected into the LLM extraction prompt for this site",
        colSpan: 4,
      },
    ],
  },
]

const SCRAPE_MODE_LABELS: Record<string, string> = {
  auto: "Auto",
  calendar: "Calendar",
  directory: "Directory",
  search: "Search",
  skip: "Skip",
}

const SCRAPE_MODE_VARIANTS: Record<string, "info" | "success" | "warning" | "neutral" | "error"> = {
  auto: "info",
  calendar: "success",
  directory: "info",
  search: "success",
  skip: "neutral",
}

const STATUS_LABELS: Record<string, string> = {
  success: "OK",
  partial: "Partial",
  failed: "Failed",
  blocked: "Blocked",
}

const STATUS_VARIANTS: Record<string, "success" | "warning" | "error" | "neutral"> = {
  success: "success",
  partial: "warning",
  failed: "error",
  blocked: "error",
}

export function SourceSitesManager() {
  const [sites, setSites] = useState<SourceSite[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [runningSite, setRunningSite] = useState<string | null>(null)

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/source-sites")
      if (!res.ok) throw new Error("Failed to fetch")
      setSites(await res.json())
    } catch {
      toast.error("Failed to load source sites")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSites()
  }, [fetchSites])

  const handleCreate = async (values: Record<string, unknown>) => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/source-sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          url: values.url || null,
          sourceMode: values.sourceMode || "automated",
          manualCheckFrequencyDays: values.manualCheckFrequencyDays
            ? parseInt(values.manualCheckFrequencyDays as string)
            : null,
          scrapeMode: values.scrapeMode || "auto",
          urlPattern: values.urlPattern || null,
          notes: values.notes || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to create")
      toast.success("Source site created")
      setFormValues({})
      setFormErrors({})
      setFormOpen(false)
      fetchSites()
    } catch {
      toast.error("Failed to create source site")
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleSite = async (s: SourceSite, active: boolean) => {
    try {
      await fetch(`/api/source-sites/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      fetchSites()
    } catch {
      toast.error("Failed to update source site")
    }
  }

  const deleteSite = async (s: SourceSite) => {
    if (!confirm(`Delete source site "${s.name}"?`)) return
    try {
      await fetch(`/api/source-sites/${s.id}`, { method: "DELETE" })
      toast.success("Source site deleted")
      fetchSites()
    } catch {
      toast.error("Failed to delete source site")
    }
  }

  const runSiteCheck = async (s: SourceSite) => {
    setRunningSite(s.id)
    toast.info(`Checking ${s.name}...`)

    try {
      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceSiteId: s.id }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? `${s.name} check failed`)
        return
      }

      if (data.manualResults) {
        const checked = data.manualResults.find((r: any) => r.status === "checked")
        const skipped = data.manualResults.find((r: any) => r.status === "skipped_fresh")
        if (checked) {
          toast.success(`${s.name} check recorded`)
        } else if (skipped) {
          toast.info(`${s.name} was already checked recently`)
        }
      } else {
        toast.success(`${s.name} — ${data.recordsNew} new events found`)
      }
      fetchSites()
    } catch {
      toast.error(`${s.name} check request failed`)
    } finally {
      setRunningSite(null)
    }
  }

  const formatDate = (iso: string | null) => {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const activeSites = sites.filter((s) => s.active && s.scrapeMode !== "skip")
  const skippedSites = sites.filter((s) => s.scrapeMode === "skip")
  const manualSites = sites.filter((s) => s.sourceMode === "manual")

  const columns: ColumnDef<SourceSite, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const s = row.original
        return (
          <div>
            <p className="font-medium text-sm">{s.name}</p>
            {s.url && (
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                {s.url}
              </p>
            )}
          </div>
        )
      },
    },
    {
      id: "sourceMode",
      header: "Source",
      cell: ({ row }) => {
        const sm = row.original.sourceMode
        return (
          <Badge variant={sm === "manual" ? "warning" : "success"} size="sm">
            {sm === "manual" ? "Manual" : "Auto"}
          </Badge>
        )
      },
    },
    {
      id: "scrapeMode",
      header: "Mode",
      cell: ({ row }) => (
        <Badge variant={SCRAPE_MODE_VARIANTS[row.original.scrapeMode] ?? "neutral"} size="sm">
          {SCRAPE_MODE_LABELS[row.original.scrapeMode] ?? row.original.scrapeMode}
        </Badge>
      ),
    },
    {
      id: "lastCheck",
      header: "Last Checked",
      cell: ({ row }) => {
        const s = row.original
        const lastAt = s.sourceMode === "manual" ? s.lastManualCheckAt : s.lastScrapedAt
        if (!lastAt) return <span className="text-xs text-muted-foreground">Never</span>
        return (
          <div>
            <p className="text-xs">{formatDate(lastAt)}</p>
            {s.lastScrapeStatus && (
              <Badge variant={STATUS_VARIANTS[s.lastScrapeStatus] ?? "neutral"} size="sm">
                {STATUS_LABELS[s.lastScrapeStatus] ?? s.lastScrapeStatus}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      id: "eventsFound",
      header: "Events",
      meta: { align: "center" as const },
      cell: ({ row }) => (
        <span className="text-sm">{row.original.eventsFound}</span>
      ),
    },
    {
      id: "active",
      header: "Active",
      meta: { align: "center" as const },
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Switch
            checked={row.original.active}
            onCheckedChange={(checked) => toggleSite(row.original, checked)}
            size="sm"
          />
        </div>
      ),
    },
  ]

  const rowActions = (s: SourceSite) => (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          runSiteCheck(s)
        }}
        loading={runningSite === s.id}
        disabled={runningSite !== null}
        title={`Check ${s.name} now`}
      >
        <Play className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          deleteSite(s)
        }}
        title="Delete source site"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{activeSites.length} active</span>
          <span>·</span>
          <span>{manualSites.length} manual</span>
          <span>·</span>
          <span>{skippedSites.length} skipped</span>
          <span>·</span>
          <span>{sites.length} total</span>
        </div>
        <Button onClick={() => setFormOpen(true)} leftIcon={Plus}>
          Add Source Site
        </Button>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Source Site</DialogTitle>
            <DialogDescription>Add event directories and websites to check during ingestion.</DialogDescription>
          </DialogHeader>
          <UniversalForm
            title=""
            variant="standard"
            sections={SOURCE_SITE_FORM_SECTIONS}
            values={formValues}
            errors={formErrors}
            onChange={(name, value) =>
              setFormValues((prev) => ({ ...prev, [name]: value }))
            }
            onSubmit={handleCreate}
            onCancel={() => {
              setFormValues({})
              setFormErrors({})
              setFormOpen(false)
            }}
            isLoading={isSubmitting}
            primaryLabel="Create Source Site"
            bare
          />
        </DialogContent>
      </Dialog>

      <UniversalList
        columns={columns}
        data={sites}
        getRowId={(row) => row.id}
        isLoading={loading}
        emptyMessage="No source sites yet."
        ariaLabel="Source Sites"
        rowActions={rowActions}
        searchPlaceholder="Search source sites..."
      />
    </div>
  )
}
