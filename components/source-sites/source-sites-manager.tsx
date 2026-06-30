"use client"

import React, { useState, useCallback, useEffect } from "react"
import { UniversalForm } from "@/components/ui/form/universal-form"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Trash2, Plus } from "lucide-react"
import type { FormSection as FormSectionType } from "@/types/components"
import { toast } from "sonner"
import { ColumnDef } from "@tanstack/react-table"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceSite {
  id: string
  name: string
  url: string | null
  active: boolean
  urlPattern: string | null
  scrapeMode: string
  notes: string | null
  lastScrapedAt: string | null
  lastScrapeStatus: string | null
  eventsFound: number
}

// ─── Form Sections ────────────────────────────────────────────────────────────

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
        placeholder: "LLM instructions for this site, e.g. 'Events listed in HTML tables. Columns: Event name, dates, city.'",
        helperText: "Injected into the LLM extraction prompt for this site",
        colSpan: 4,
      },
    ],
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export function SourceSitesManager() {
  const [sites, setSites] = useState<SourceSite[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

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

  const formatDate = (iso: string | null) => {
    if (!iso) return "—"
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  // ── Derived counts ─────────────────────────────────────────────────────────

  const activeSites = sites.filter((s) => s.active && s.scrapeMode !== "skip")
  const skippedSites = sites.filter((s) => s.scrapeMode === "skip")

  // ── Columns ──────────────────────────────────────────────────────────────

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
      id: "scrapeMode",
      header: "Mode",
      cell: ({ row }) => (
        <Badge variant={SCRAPE_MODE_VARIANTS[row.original.scrapeMode] ?? "neutral"} size="sm">
          {SCRAPE_MODE_LABELS[row.original.scrapeMode] ?? row.original.scrapeMode}
        </Badge>
      ),
    },
    {
      id: "lastScraped",
      header: "Last Scraped",
      cell: ({ row }) => {
        const s = row.original
        if (!s.lastScrapedAt) return <span className="text-xs text-muted-foreground">Never</span>
        return (
          <div>
            <p className="text-xs">{formatDate(s.lastScrapedAt)}</p>
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
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Add Source Site Button + Summary */}
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{activeSites.length} active (scraped in Phase 1)</span>
          <span>·</span>
          <span>{skippedSites.length} skipped</span>
          <span>·</span>
          <span>{sites.length} total</span>
        </div>
        <Button onClick={() => setFormOpen(true)} leftIcon={Plus}>
          Add Source Site
        </Button>
      </div>

      {/* Add Source Site Dialog */}
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
