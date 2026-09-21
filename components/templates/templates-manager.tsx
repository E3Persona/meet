"use client"

import React, { useState, useCallback, useEffect } from "react"
import { UniversalForm } from "@/components/ui/form/universal-form"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Trash2, Plus, Play } from "lucide-react"
import type { FormSection as FormSectionType } from "@/types/components"
import { toast } from "sonner"
import { ColumnDef } from "@tanstack/react-table"

interface SearchTemplate {
  id: string
  template: string
  scope: "CITY" | "VENUE" | "GLOBAL"
  active: boolean
  createdAt: string
  updatedAt: string
}

interface SearchTermRecord {
  id: string
  keyword: string
  locationId: string | null
  active: boolean
  createdAt: string
  updatedAt: string
  location: { name: string; city: string; state: string } | null
}

interface UnifiedPhrase {
  id: string
  type: "template" | "literal"
  phrase: string
  scopeLabel: string
  scopeVariant: "info" | "success" | "neutral" | "warning"
  active: boolean
  scope: "CITY" | "VENUE" | "GLOBAL" | "LOCATION"
  locationId: string | null
}

interface LocationOption {
  id: string
  name: string
  type: "CITY" | "VENUE"
  city: string | null
  state: string | null
  active: boolean
}

const SCOPE_LABELS: Record<string, string> = {
  CITY: "City",
  VENUE: "Venue",
  GLOBAL: "Global",
}

const SCOPE_VARIANTS: Record<string, "info" | "success" | "neutral"> = {
  CITY: "info",
  VENUE: "success",
  GLOBAL: "neutral",
}

const TEMPLATE_FORM_SECTIONS: FormSectionType[] = [
  {
    id: "details",
    title: "Search Template",
    description:
      "Use {CITY}, {VENUE}, {MONTH}, {YEAR} as placeholders — they are resolved per-location at ingestion time.",
    columns: 4,
    fields: [
      {
        name: "template",
        label: "Template",
        type: "text",
        placeholder: "e.g. {CITY} meeting listings",
        required: true,
        colSpan: 4,
      },
      {
        name: "scope",
        label: "Scope",
        type: "select",
        options: [
          { label: "City (resolves per CITY location)", value: "CITY" },
          { label: "Venue (resolves per VENUE location)", value: "VENUE" },
          { label: "Global (runs once, no expansion)", value: "GLOBAL" },
        ],
        required: true,
        colSpan: 4,
      },
    ],
  },
]

export function TemplatesManager() {
  const [phrases, setPhrases] = useState<UnifiedPhrase[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  // ── Run dialog state ────────────────────────────────────────────────────
  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const [runTarget, setRunTarget] = useState<UnifiedPhrase | null>(null)
  const [runLocations, setRunLocations] = useState<LocationOption[]>([])
  const [runSelectedLocationIds, setRunSelectedLocationIds] = useState<string[]>([])
  const [runLoading, setRunLoading] = useState(false)

  const fetchAll = useCallback(async () => {
    try {
      const [templatesRes, termsRes] = await Promise.all([
        fetch("/api/search-templates"),
        fetch("/api/search-terms"),
      ])
      if (!templatesRes.ok || !termsRes.ok) throw new Error("Failed to fetch")
      const templates: SearchTemplate[] = await templatesRes.json()
      const terms: SearchTermRecord[] = await termsRes.json()

      const unified: UnifiedPhrase[] = [
        ...templates.map((t) => ({
          id: t.id,
          type: "template" as const,
          phrase: t.template,
          scopeLabel: SCOPE_LABELS[t.scope] ?? t.scope,
          scopeVariant: SCOPE_VARIANTS[t.scope] ?? "neutral",
          active: t.active,
          scope: t.scope,
          locationId: null,
        })),
        ...terms.map((t) => ({
          id: t.id,
          type: "literal" as const,
          phrase: t.keyword,
          scopeLabel: t.location ? `${t.location.name} (${t.location.city}, ${t.location.state})` : "Global",
          scopeVariant: t.location ? "warning" as const : "neutral" as const,
          active: t.active,
          scope: t.locationId ? "LOCATION" as const : "GLOBAL" as const,
          locationId: t.locationId,
        })),
      ]

      setPhrases(unified)
    } catch {
      toast.error("Failed to load search phrases")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const handleCreate = async (values: Record<string, unknown>) => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/search-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template: values.template,
          scope: values.scope || "CITY",
        }),
      })
      if (!res.ok) throw new Error("Failed to create")
      toast.success("Template created")
      setFormValues({})
      setFormErrors({})
      setFormOpen(false)
      fetchAll()
    } catch {
      toast.error("Failed to create template")
    } finally {
      setIsSubmitting(false)
    }
  }

  const togglePhrase = async (p: UnifiedPhrase, active: boolean) => {
    try {
      const endpoint = p.type === "template" ? "search-templates" : "search-terms"
      await fetch(`/api/${endpoint}/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      fetchAll()
    } catch {
      toast.error(`Failed to update ${p.type}`)
    }
  }

  const deletePhrase = async (p: UnifiedPhrase) => {
    const label = p.type === "template" ? "template" : "keyword"
    if (!confirm(`Delete ${label} "${p.phrase}"?`)) return
    try {
      const endpoint = p.type === "template" ? "search-templates" : "search-terms"
      await fetch(`/api/${endpoint}/${p.id}`, { method: "DELETE" })
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted`)
      fetchAll()
    } catch {
      toast.error(`Failed to delete ${label}`)
    }
  }

  // ── Run handlers ─────────────────────────────────────────────────────────

  const needsLocationPicker = (p: UnifiedPhrase) =>
    p.type === "template" && (p.scope === "CITY" || p.scope === "VENUE")

  const openRunDialog = async (p: UnifiedPhrase) => {
    setRunTarget(p)
    setRunSelectedLocationIds([])

    if (!needsLocationPicker(p)) {
      executeRun(p, [])
      return
    }

    try {
      const res = await fetch("/api/locations")
      if (!res.ok) throw new Error("Failed to fetch")
      const all: LocationOption[] = await res.json()
      const filtered = all.filter((l) => l.type === p.scope && l.active)
      setRunLocations(filtered)
    } catch {
      toast.error("Failed to load locations")
      return
    }

    setRunDialogOpen(true)
  }

  // Single search action — delegates to `runSearchTemplates` via the
  // /api/ingest/search-templates route (targeted mode), which expands the
  // chosen template/term × location × month tuples, runs the search pipeline,
  // and persists WebSearchQuery/WebSearchResult/Event/SearchExecution rows.
  const executeRun = async (p: UnifiedPhrase, locationIds: string[]) => {
    setRunLoading(true)
    setRunDialogOpen(false)
    toast.info(`Starting search for "${p.phrase}"...`)

    try {
      const body: Record<string, unknown> = {}

      if (p.type === "template") {
        body.searchTemplateIds = [p.id]
      } else {
        body.searchTermIds = [p.id]
      }
      if (locationIds.length > 0) body.locationIds = locationIds

      const res = await fetch("/api/ingest/search-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? "Search failed")
        return
      }

      toast.success(
        `Search complete: ${data.resultsSaved} results saved, ${data.eventsEnriched} events enriched`
      )
      fetchAll()
    } catch {
      toast.error("Search request failed")
    } finally {
      setRunLoading(false)
    }
  }

  const handleRunConfirm = () => {
    if (!runTarget) return
    executeRun(runTarget, runSelectedLocationIds)
  }

  const toggleRunLocation = (id: string) => {
    setRunSelectedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const selectAllRunLocations = () => {
    setRunSelectedLocationIds(runLocations.map((l) => l.id))
  }

  // ── Table columns ────────────────────────────────────────────────────────

  const columns: ColumnDef<UnifiedPhrase, unknown>[] = [
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant={row.original.type === "template" ? "info" : "warning"} size="sm">
          {row.original.type === "template" ? "Template" : "Literal"}
        </Badge>
      ),
    },
    {
      accessorKey: "phrase",
      header: "Phrase",
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-sm font-mono">{row.original.phrase}</p>
        </div>
      ),
    },
    {
      id: "scope",
      header: "Scope / Location",
      cell: ({ row }) => (
        <Badge variant={row.original.scopeVariant} size="sm">
          {row.original.scopeLabel}
        </Badge>
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
            onCheckedChange={(checked) => togglePhrase(row.original, checked)}
            size="sm"
          />
        </div>
      ),
    },
  ]

  const rowActions = (p: UnifiedPhrase) => (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          openRunDialog(p)
        }}
        disabled={runLoading}
        title={`Run search for ${p.type}`}
      >
        <Play className="h-3.5 w-3.5 text-primary" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          deletePhrase(p)
        }}
        title={`Delete ${p.type}`}
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </>
  )

  const templateCount = phrases.filter((p) => p.type === "template").length
  const literalCount = phrases.filter((p) => p.type === "literal").length

  const runTargetLabel = runTarget?.scope === "CITY" ? "cities" : "venues"

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {templateCount} template{templateCount !== 1 ? "s" : ""} &middot; {literalCount} literal keyword{literalCount !== 1 ? "s" : ""}
        </p>
        <Button onClick={() => setFormOpen(true)} leftIcon={Plus}>
          Add Template
        </Button>
      </div>

      {/* ── Create template dialog ──────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Search Template</DialogTitle>
            <DialogDescription>
              Templates are resolved per-location at ingestion time. Use {"{CITY}"}, {"{VENUE}"}, {"{MONTH}"}, {"{YEAR}"} as placeholders.
            </DialogDescription>
          </DialogHeader>
          <UniversalForm
            title=""
            variant="standard"
            sections={TEMPLATE_FORM_SECTIONS}
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
            primaryLabel="Create Template"
            bare
          />
        </DialogContent>
      </Dialog>

      {/* ── Run location picker dialog ──────────────────────────────────── */}
      <Dialog open={runDialogOpen} onOpenChange={setRunDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Search</DialogTitle>
            <DialogDescription>
              Select which {runTargetLabel} to run this search for.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>{runLocations.length} available ({runSelectedLocationIds.length} selected)</Label>
              <button
                type="button"
                onClick={selectAllRunLocations}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Select all
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto border border-border rounded-md p-2 space-y-0.5 text-sm">
              {runLocations.length === 0 && (
                <p className="text-muted-foreground text-xs p-2">Loading {runTargetLabel}...</p>
              )}
              {runLocations.map((loc) => (
                <label
                  key={loc.id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-2 py-1.5"
                >
                  <Checkbox
                    checked={runSelectedLocationIds.includes(loc.id)}
                    onCheckedChange={() => toggleRunLocation(loc.id)}
                  />
                  <span className="font-medium">{loc.name}</span>
                  {loc.city && loc.city !== loc.name && (
                    <span className="text-xs text-muted-foreground">({loc.city}, {loc.state})</span>
                  )}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setRunDialogOpen(false)}
              disabled={runLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRunConfirm}
              leftIcon={runLoading ? undefined : Play}
              loading={runLoading}
              disabled={runSelectedLocationIds.length === 0}
            >
              {runLoading ? "Starting..." : "Run Search"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <UniversalList
        columns={columns}
        data={phrases}
        getRowId={(row) => row.id}
        isLoading={loading}
        emptyMessage="No search phrases yet."
        ariaLabel="Search Phrases"
        rowActions={rowActions}
        searchPlaceholder="Search phrases..."
      />
    </div>
  )
}
