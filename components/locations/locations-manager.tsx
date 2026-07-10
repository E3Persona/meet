"use client"

import React, { useState, useCallback, useEffect } from "react"
import { UniversalForm } from "@/components/ui/form/universal-form"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Trash2, Plus, Play, MoreHorizontal } from "lucide-react"
import { ProgressDialog } from "@/components/ui/progress-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { FormSection as FormSectionType } from "@/types/components"
import { EVENT_TYPE_KEYWORDS } from "@/lib/constants/events"
import { toast } from "sonner"
import { ColumnDef } from "@tanstack/react-table"

interface SearchTerm {
  id: string
  keyword: string
  active: boolean
  locationId: string | null
}

interface NestedLocation {
  id: string
  name: string
  shortName: string | null
}

interface Location {
  id: string
  name: string
  address: string | null
  city: string | null
  state: string | null
  sourceUrl: string | null
  active: boolean
  type: "CITY" | "VENUE"
  parentId: string | null
  lastIngestedAt: string | null
  parent: { id: string; name: string } | null
  venues: NestedLocation[]
  searchTerms: SearchTerm[]
}

const LOCATION_FORM_SECTIONS: FormSectionType[] = [
  {
    id: "details",
    title: "Location Details",
    description: "Add a city or venue to track events at",
    columns: 4,
    fields: [
      {
        name: "type",
        label: "Type",
        type: "select",
        options: [
          { label: "Venue", value: "VENUE" },
          { label: "City", value: "CITY" },
        ],
        required: true,
        colSpan: 2,
      },
      {
        name: "parentId",
        label: "Parent City Name",
        type: "text",
        placeholder: "e.g. Philadelphia",
        colSpan: 2,
        helperText: "For Venues only — type the name of the city this venue belongs to. Leave blank for Cities.",
      },
      {
        name: "name",
        label: "Name",
        type: "text",
        placeholder: "e.g. Philadelphia Marriott Downtown",
        required: true,
        colSpan: 4,
      },
      {
        name: "address",
        label: "Address",
        type: "text",
        placeholder: "e.g. 1201 Market Street",
        colSpan: 4,
      },
      {
        name: "city",
        label: "City",
        type: "text",
        placeholder: "e.g. Philadelphia",
        colSpan: 2,
      },
      {
        name: "state",
        label: "State",
        type: "text",
        placeholder: "e.g. PA",
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

export function LocationsManager() {
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [runningLocationId, setRunningLocationId] = useState<string | null>(null)
  const [runningAll, setRunningAll] = useState(false)
  const [progressRunId, setProgressRunId] = useState<string | null>(null)
  const [progressTitle, setProgressTitle] = useState("")

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
          type: values.type || "VENUE",
          parentId: values.parentId || null,
          searchTerms: EVENT_TYPE_KEYWORDS,
        }),
      })
      if (!res.ok) throw new Error("Failed to create")
      toast.success("Location created")
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

  const deleteLocation = async (location: Location) => {
    if (!confirm(`Delete "${location.name}" and all its events?`)) return
    try {
      await fetch(`/api/locations/${location.id}`, { method: "DELETE" })
      toast.success("Location deleted")
      fetchLocations()
    } catch {
      toast.error("Failed to delete location")
    }
  }

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

  const deleteSearchTerm = async (term: SearchTerm) => {
    try {
      await fetch(`/api/search-terms/${term.id}`, { method: "DELETE" })
      fetchLocations()
    } catch {
      toast.error("Failed to delete search term")
    }
  }

  const runScraper = async (locationId: string, locationName: string) => {
    setRunningLocationId(locationId)
    const clientRunId = crypto.randomUUID()
    setProgressTitle(`Running: ${locationName}`)
    setProgressRunId(clientRunId)
    try {
      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationIds: [locationId], clientRunId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Scraper failed")
        return
      }
      setProgressTitle(`Complete: ${locationName}`)
      toast.success(`${locationName}: ${data.recordsNew} new events (${data.recordsFound} scanned)`)

      if (data.warnings?.length > 0) {
        const uniqueWarnings = [...new Set(data.warnings)]
        toast.warning(`Provider issues: ${uniqueWarnings.slice(0, 3).join("; ")}${uniqueWarnings.length > 3 ? ` (+${uniqueWarnings.length - 3} more)` : ""}`)
      }

      fetchLocations()
    } catch {
      toast.error("Scraper request failed")
    } finally {
      setRunningLocationId(null)
    }
  }

  const runAllScrapers = async () => {
    setRunningAll(true)
    const clientRunId = crypto.randomUUID()
    setProgressTitle("Running: All Locations")
    setProgressRunId(clientRunId)
    try {
      const activeIds = locations.filter((l) => l.active).map((l) => l.id)
      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationIds: activeIds, clientRunId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Scraper failed")
        return
      }
      setProgressTitle(`Complete: All Locations`)
      toast.success(`All locations: ${data.recordsNew} new events (${data.recordsFound} scanned)`)

      if (data.warnings?.length > 0) {
        const uniqueWarnings = [...new Set(data.warnings)]
        toast.warning(`Provider issues: ${uniqueWarnings.slice(0, 3).join("; ")}${uniqueWarnings.length > 3 ? ` (+${uniqueWarnings.length - 3} more)` : ""}`)
      }

      fetchLocations()
    } catch {
      toast.error("Scraper request failed")
    } finally {
      setRunningAll(false)
    }
  }

  const cities = locations.filter((l) => l.type === "CITY")
  const venues = locations.filter((l) => l.type === "VENUE")

  const columns: ColumnDef<Location, unknown>[] = [
    {
      id: "name",
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
            {loc.type === "VENUE" && loc.parent && (
              <p className="text-xs text-muted-foreground">
                ← {loc.parent.name}
              </p>
            )}
          </div>
        )
      },
    },
    {
      id: "type",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant={row.original.type === "CITY" ? "info" : "neutral"} size="sm">
          {row.original.type === "CITY" ? "City" : "Venue"}
        </Badge>
      ),
    },
    {
      id: "venues",
      header: "Venues",
      meta: { align: "center" },
      cell: ({ row }) => {
        const loc = row.original
        if (loc.type !== "CITY") return <span className="text-xs text-muted-foreground">—</span>
        return (
          <span className="text-sm">{loc.venues.length}</span>
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
      id: "lastRun",
      header: "Last Run",
      cell: ({ row }) => {
        const val = row.original.lastIngestedAt
        if (!val) return <span className="text-xs text-muted-foreground italic">Never</span>
        const d = new Date(val)
        const now = new Date()
        const diff = now.getTime() - d.getTime()
        const days = Math.floor(diff / (1000 * 60 * 60 * 24))
        const label = days === 0
          ? "Today"
          : days === 1
            ? "Yesterday"
            : `${days} days ago`
        return (
          <span className="text-xs" title={d.toLocaleString()}>
            {label}
          </span>
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

  const rowActions = (location: Location) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem
          onClick={() => runScraper(location.id, location.name)}
          disabled={runningLocationId === location.id || runningAll}
        >
          <Play className="h-4 w-4 mr-2" />
          {runningLocationId === location.id ? "Running..." : "Run Scraper"}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => deleteLocation(location)}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {cities.length} cit{cities.length === 1 ? "y" : "ies"} · {venues.length} venues
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={runAllScrapers}
            disabled={runningAll || runningLocationId !== null}
            leftIcon={runningAll ? undefined : Play}
            loading={runningAll}
          >
            {runningAll ? "Running..." : "Run All"}
          </Button>
          <Button onClick={() => setFormOpen(true)} leftIcon={Plus}>
            Add Location
          </Button>
        </div>
      </div>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Add Location</DialogTitle>
            <DialogDescription>Add a city or venue to start tracking events.</DialogDescription>
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

      <ProgressDialog
        open={progressRunId !== null}
        title={progressTitle}
        runId={progressRunId}
        onComplete={() => {}}
      />

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
        </CardContent>
      )}
    </Card>
  )
}
