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

interface SearchTemplate {
  id: string
  template: string
  active: boolean
  createdAt: string
  updatedAt: string
}

// ─── Form Sections ────────────────────────────────────────────────────────────

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
    ],
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplatesManager() {
  const [templates, setTemplates] = useState<SearchTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await fetch("/api/search-templates")
      if (!res.ok) throw new Error("Failed to fetch")
      setTemplates(await res.json())
    } catch {
      toast.error("Failed to load templates")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  const handleCreate = async (values: Record<string, unknown>) => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/search-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: values.template }),
      })
      if (!res.ok) throw new Error("Failed to create")
      toast.success("Template created")
      setFormValues({})
      setFormErrors({})
      setFormOpen(false)
      fetchTemplates()
    } catch {
      toast.error("Failed to create template")
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleTemplate = async (t: SearchTemplate, active: boolean) => {
    try {
      await fetch(`/api/search-templates/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      fetchTemplates()
    } catch {
      toast.error("Failed to update template")
    }
  }

  const deleteTemplate = async (t: SearchTemplate) => {
    if (!confirm(`Delete template "${t.template}"?`)) return
    try {
      await fetch(`/api/search-templates/${t.id}`, { method: "DELETE" })
      toast.success("Template deleted")
      fetchTemplates()
    } catch {
      toast.error("Failed to delete template")
    }
  }

  // ── Helpers: detect if template has placeholders ──────────────────────────

  const hasPlaceholders = (tpl: string) => /\{(CITY|VENUE|MONTH|YEAR)\}/.test(tpl)

  // ── Columns ──────────────────────────────────────────────────────────────

  const columns: ColumnDef<SearchTemplate, unknown>[] = [
    {
      accessorKey: "template",
      header: "Template",
      cell: ({ row }) => {
        const t = row.original
        const isTemplate = hasPlaceholders(t.template)
        return (
          <div>
            <p className="font-medium text-sm font-mono">{t.template}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isTemplate ? "Expanded per-location" : "Run as-is"}
            </p>
          </div>
        )
      },
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => {
        const isTemplate = hasPlaceholders(row.original.template)
        return (
          <Badge variant={isTemplate ? "info" : "neutral"} size="sm">
            {isTemplate ? "Template" : "Literal"}
          </Badge>
        )
      },
    },
    {
      id: "active",
      header: "Active",
      meta: { align: "center" as const },
      cell: ({ row }) => (
        <div className="flex justify-center">
          <Switch
            checked={row.original.active}
            onCheckedChange={(checked) => toggleTemplate(row.original, checked)}
            size="sm"
          />
        </div>
      ),
    },
  ]

  const rowActions = (t: SearchTemplate) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={(e) => {
        e.stopPropagation()
        deleteTemplate(t)
      }}
      title="Delete template"
    >
      <Trash2 className="h-3.5 w-3.5 text-destructive" />
    </Button>
  )

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Add Template Button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {templates.length} template{templates.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={() => setFormOpen(true)} leftIcon={Plus}>
          Add Template
        </Button>
      </div>

      {/* Add Template Dialog */}
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
        data={templates}
        getRowId={(row) => row.id}
        isLoading={loading}
        emptyMessage="No templates yet."
        ariaLabel="Search Templates"
        rowActions={rowActions}
        searchPlaceholder="Search templates..."
      />
    </div>
  )
}
