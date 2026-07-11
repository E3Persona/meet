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
        })),
        ...terms.map((t) => ({
          id: t.id,
          type: "literal" as const,
          phrase: t.keyword,
          scopeLabel: t.location ? `${t.location.name} (${t.location.city}, ${t.location.state})` : "Global",
          scopeVariant: t.location ? "warning" as const : "neutral" as const,
          active: t.active,
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
  )

  const templateCount = phrases.filter((p) => p.type === "template").length
  const literalCount = phrases.filter((p) => p.type === "literal").length

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
