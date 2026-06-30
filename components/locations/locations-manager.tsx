"use client"

import React, { useState, useCallback, useEffect } from "react"
import { UniversalForm } from "@/components/ui/form/universal-form"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Trash2, Plus } from "lucide-react"
import type { FormSection as FormSectionType } from "@/types/components"
import { EVENT_TYPE_KEYWORDS } from "@/lib/constants/events"
import { toast } from "sonner"
import { ColumnDef } from "@tanstack/react-table"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SearchTerm {
  id: string
  keyword: string
  active: boolean
  locationId: string
}

interface Location {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  sourceUrl: string | null
  active: boolean
  searchTerms: SearchTerm[]
}

// ─── Location Form Sections ───────────────────────────────────────────────────

const LOCATION_FORM_SECTIONS: FormSectionType[] = [
  {
    id: "details",
    title: "Location Details",
    description: "Add a venue or location to track events at",
    columns: 4,
    fields: [
      {
        name: "name",
        label: "Venue / Location Name",
        type: "text",
        placeholder: "e.g. Gaylord National Harbor",
        required: true,
        colSpan: 4,
      },
      {
        name: "address",
        label: "Address",
        type: "text",
        placeholder: "e.g. 201 Waterfront St",
        colSpan: 4,
      },
      {
        name: "city",
        label: "City",
        type: "text",
        placeholder: "e.g. National Harbor",
        colSpan: 2,
      },
      {
        name: "state",
        label: "State",
        type: "text",
        placeholder: "e.g. MD",
        colSpan: 2,
      },
      {
        name: "sourceUrl",
        label: "Website URL",
        type: "text",
        placeholder: "https://...",
        colSpan: 4,
      },
    ],
  },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function LocationsManager() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)

  // ── Fetch locations ────────────────────────────────────────────────────────

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/locations")
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setLocations(data)
    } catch {
      toast.error("Failed to load locations")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLocations()
  }, [fetchLocations])

  // ── Create location ────────────────────────────────────────────────────────

  const handleCreateLocation = async (values: Record<string, unknown>) => {
    setIsSubmitting(true)
    try {
      const res = await fetch("/api/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          address: values.address,
          city: values.city,
          state: values.state,
          sourceUrl: values.sourceUrl,
          searchTerms: EVENT_TYPE_KEYWORDS,
        }),
      })
      if (!res.ok) throw new Error("Failed to create")
      toast.success("Location created with all search term keywords")
      setFormValues({})
      setFormErrors({})
      setFormOpen(false)
      fetchLocations()
    } catch {
      toast.error("Failed to create location")
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Toggle location active ─────────────────────────────────────────────────

  const toggleLocation = async (location: Location, active: boolean) => {
    try {
      await fetch(`/api/locations/${location.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      fetchLocations()
    } catch {
      toast.error("Failed to update location")
    }
  }

  // ── Delete location ────────────────────────────────────────────────────────

  const deleteLocation = async (location: Location) => {
    if (!confirm(`Delete "${location.name}" and all its search terms?`)) return
    try {
      await fetch(`/api/locations/${location.id}`, { method: "DELETE" })
      toast.success("Location deleted")
      fetchLocations()
    } catch {
      toast.error("Failed to delete location")
    }
  }

  // ── Toggle search term ─────────────────────────────────────────────────────

  const toggleSearchTerm = async (term: SearchTerm, active: boolean) => {
    try {
      await fetch(`/api/search-terms/${term.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
      })
      fetchLocations()
    } catch {
      toast.error("Failed to update search term")
    }
  }

  // ── Delete search term ─────────────────────────────────────────────────────

  const deleteSearchTerm = async (term: SearchTerm) => {
    try {
      await fetch(`/api/search-terms/${term.id}`, { method: "DELETE" })
      fetchLocations()
    } catch {
      toast.error("Failed to delete search term")
    }
  }

  // ── Add missing keywords to a location ─────────────────────────────────────

  const addMissingKeywords = async (location: Location) => {
    const existing = new Set(location.searchTerms.map((t) => t.keyword))
    const missing = EVENT_TYPE_KEYWORDS.filter((k) => !existing.has(k))
    if (missing.length === 0) {
      toast.info("All keywords already added")
      return
    }
    try {
      for (const keyword of missing) {
        await fetch("/api/search-terms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword, locationId: location.id }),
        })
      }
      toast.success(`Added ${missing.length} missing keywords`)
      fetchLocations()
    } catch {
      toast.error("Failed to add keywords")
    }
  }

  // ── Columns for the locations list ─────────────────────────────────────────

  const columns: ColumnDef<Location, unknown>[] = [
    {
      accessorKey: "name",
      header: "Location",
      cell: ({ row }) => {
        const loc = row.original
        return (
          <div>
            <p className="font-medium text-sm">{loc.name}</p>
            {loc.city && loc.state && (
              <p className="text-xs text-muted-foreground">
                {loc.city}, {loc.state}
              </p>
            )}
          </div>
        )
      },
    },
    {
      id: "searchTerms",
      header: "Search Terms",
      cell: ({ row }) => {
        const loc = row.original
        const activeCount = loc.searchTerms.filter((t) => t.active).length
        return (
          <div className="flex items-center gap-2">
            <Badge variant={activeCount > 0 ? "info" : "neutral"} size="sm">
              {activeCount} active
            </Badge>
            <span className="text-xs text-muted-foreground">
              / {loc.searchTerms.length} total
            </span>
          </div>
        )
      },
    },
    {
      id: "active",
      header: "Active",
      meta: { align: "center" },
      cell: ({ row }) => {
        const loc = row.original
        return (
          <div className="flex justify-center">
            <Switch
              checked={loc.active}
              onCheckedChange={(checked) => toggleLocation(loc, checked)}
              size="sm"
            />
          </div>
        )
      },
    },
  ]

  // ── Row actions ────────────────────────────────────────────────────────────

  const rowActions = (location: Location) => (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          addMissingKeywords(location)
        }}
        title="Add missing keywords"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          deleteLocation(location)
        }}
        title="Delete location"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Add Location Button */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {locations.length} location{locations.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={() => setFormOpen(true)} leftIcon={Plus}>
          Add Location
        </Button>
      </div>

      {/* Add Location Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
            <DialogDescription>Add a venue to start tracking events.</DialogDescription>
          </DialogHeader>
          <UniversalForm
            title=""
            variant="standard"
            sections={LOCATION_FORM_SECTIONS}
            values={formValues}
            errors={formErrors}
            onChange={(name, value) =>
              setFormValues((prev) => ({ ...prev, [name]: value }))
            }
            onSubmit={handleCreateLocation}
            onCancel={() => {
              setFormValues({})
              setFormErrors({})
              setFormOpen(false)
            }}
            isLoading={isSubmitting}
            primaryLabel="Create Location"
            bare
          />
        </DialogContent>
      </Dialog>

      {/* Locations List */}
      <UniversalList
        columns={columns}
        data={locations}
        getRowId={(row) => row.id}
        isLoading={loading}
        emptyMessage="No locations added yet."
        ariaLabel="Locations"
        rowActions={rowActions}
        searchPlaceholder="Search locations..."
      />

      {/* Location Detail — Search Terms */}
      {locations.map((loc) => (
        <LocationSearchTerms
          key={loc.id}
          location={loc}
          onRefresh={fetchLocations}
        />
      ))}
    </div>
  )
}

// ─── Search Terms Sub-Panel ───────────────────────────────────────────────────

function LocationSearchTerms({
  location,
  onRefresh,
}: {
  location: Location
  onRefresh: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (location.searchTerms.length === 0) return null

  const toggleTerm = async (term: SearchTerm, active: boolean) => {
    await fetch(`/api/search-terms/${term.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    })
    onRefresh()
  }

  const removeTerm = async (term: SearchTerm) => {
    await fetch(`/api/search-terms/${term.id}`, { method: "DELETE" })
    onRefresh()
  }

  const addMissing = async () => {
    const existing = new Set(location.searchTerms.map((t) => t.keyword))
    const missing = EVENT_TYPE_KEYWORDS.filter((k) => !existing.has(k))
    if (missing.length === 0) {
      toast.info("All keywords already added")
      return
    }
    for (const keyword of missing) {
      await fetch("/api/search-terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, locationId: location.id }),
      })
    }
    toast.success(`Added ${missing.length} missing keywords`)
    onRefresh()
  }

  return (
    <Card>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-muted/30"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">
            {location.name} — Search Terms
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {location.searchTerms.filter((t) => t.active).length} active of{" "}
            {location.searchTerms.length} keywords
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {isExpanded ? "▲ Collapse" : "▼ Expand"}
        </span>
      </button>
      {isExpanded && (
        <CardContent className="border-t border-border pt-4">
          <div className="flex flex-wrap gap-2">
            {location.searchTerms.map((term) => (
              <div key={term.id} className="flex items-center gap-1.5">
                <Badge
                  variant={term.active ? "info" : "neutral"}
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => toggleTerm(term, !term.active)}
                >
                  {term.keyword}
                </Badge>
                <button
                  type="button"
                  onClick={() => removeTerm(term)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={addMissing}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Missing Keywords
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
