"use client"

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react"
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import {
  ArrowUpDown,
  Download,
  Upload,
  Pencil,
  Check,
  X,
  Search,
  Loader2,
  Trash2,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  FileText,
  StickyNote,
} from "lucide-react"
import { toast } from "sonner"
import { ContactFinderModal } from "./contact-finder-modal"
import { ProgressDialog } from "@/components/ui/progress-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

interface EventContact {
  id: string
  name: string
  isPrimary: boolean
  email: string | null
  phone: string | null
  title: string | null
}

interface EventRow {
  id: string
  eventName: string
  eventDateStart: string | null
  eventDateEnd: string | null
  expectedAttendees: number | null
  sourceUrl: string | null
  organizerName: string | null
  organizerTitle: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  contactNote: string | null
  status: "new" | "reviewed" | "contacted"
  dateAdded: string
  location: { name: string; city: string | null; state: string | null }
  contacts: EventContact[]
}

interface Location {
  id: string
  name: string
  type: "CITY" | "VENUE"
  city: string | null
  state: string | null
  parentId: string | null
}

// ─── Inline Edit Cell ─────────────────────────────────────────────────────────

function InlineEditCell({
  value,
  eventId,
  field,
  onSaved,
}: {
  value: string | null
  eventId: string
  field: string
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? "")

  const save = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: draft || null }),
      })
      if (!res.ok) throw new Error("Failed")
      setEditing(false)
      onSaved()
    } catch {
      toast.error("Failed to update")
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group -mx-1 flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-sm hover:bg-muted/50"
      >
        <span className={value ? "" : "text-muted-foreground italic"}>
          {value || "Add..."}
        </span>
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") save()
          if (e.key === "Escape") {
            setEditing(false)
            setDraft(value ?? "")
          }
        }}
      />
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={save}>
        <Check className="h-3.5 w-3.5 text-emerald-600" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={() => {
          setEditing(false)
          setDraft(value ?? "")
        }}
      >
        <X className="h-3.5 w-3.5 text-muted-foreground" />
      </Button>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  new: { variant: "info" as const, label: "New" },
  reviewed: { variant: "warning" as const, label: "Reviewed" },
  contacted: { variant: "success" as const, label: "Contacted" },
}

function StatusBadge({
  status,
  eventId,
  onSaved,
}: {
  status: string
  eventId: string
  onSaved: () => void
}) {
  const [currentStatus, setCurrentStatus] = useState(status)

  const handleChange = async (newStatus: string) => {
    try {
      await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      setCurrentStatus(newStatus)
      onSaved()
    } catch {
      toast.error("Failed to update status")
    }
  }

  const config =
    STATUS_CONFIG[currentStatus as keyof typeof STATUS_CONFIG] ??
    STATUS_CONFIG.new

  return (
    <Select value={currentStatus} onValueChange={handleChange}>
      <SelectTrigger className="h-7 w-28 text-xs" size="sm">
        <Badge variant={config.variant} size="sm">
          {config.label}
        </Badge>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="new">New</SelectItem>
        <SelectItem value="reviewed">Reviewed</SelectItem>
        <SelectItem value="contacted">Contacted</SelectItem>
      </SelectContent>
    </Select>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EventsTable() {
  const [events, setEvents] = useState<EventRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterCity, setFilterCity] = useState<string>("all")
  const [filterLocation, setFilterLocation] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "eventDateStart", desc: true },
  ])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [filterHasContact, setFilterHasContact] = useState<string>("true")
  const [filterDateFrom, setFilterDateFrom] = useState<string>("")
  const [filterDateTo, setFilterDateTo] = useState<string>("")
  const [exportMonth, setExportMonth] = useState<string>("all")
  const [exportYear, setExportYear] = useState<string>(
    String(new Date().getFullYear())
  )

  // Contact finder modal state
  const [contactModal, setContactModal] = useState<{
    open: boolean
    eventId: string
    eventName: string
  }>({ open: false, eventId: "", eventName: "" })
  const [findAllLoading, setFindAllLoading] = useState(false)
  const [deleteAllLoading, setDeleteAllLoading] = useState(false)
  const [eventsMissingContacts, setEventsMissingContacts] = useState(0)
  const [eventsWithContacts, setEventsWithContacts] = useState(0)

  // Import dialog state
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult, setImportResult] = useState<{
    created: number
    skipped: number
    errors: number
    details: string[]
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchRunning, setSearchRunning] = useState(false)
  const [forceRefresh, setForceRefresh] = useState(false)
  const [progressRunId, setProgressRunId] = useState<string | null>(null)
  const [progressTitle, setProgressTitle] = useState("")

  const setCityFilter = (val: string) => {
    setFilterCity(val)
    setFilterLocation("all")
    setPage(1)
  }
  const setLocationFilter = (val: string) => {
    setFilterLocation(val)
    setPage(1)
  }
  const setStatusFilter = (val: string) => {
    setFilterStatus(val)
    setPage(1)
  }
  const setSearchFilter = (val: string) => {
    setSearch(val)
    setPage(1)
  }
  const setHasContactFilter = (val: string) => {
    setFilterHasContact(val)
    setPage(1)
  }
  const setDateFromFilter = (val: string) => {
    setFilterDateFrom(val)
    setPage(1)
  }
  const setDateToFilter = (val: string) => {
    setFilterDateTo(val)
    setPage(1)
  }

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterCity !== "all" && filterLocation === "all")
        params.set("cityId", filterCity)
      if (filterLocation !== "all") params.set("locationId", filterLocation)
      if (filterStatus !== "all") params.set("status", filterStatus)
      if (filterHasContact !== "all") params.set("hasContact", filterHasContact)
      if (search) params.set("search", search)
      if (filterDateFrom) params.set("dateFrom", filterDateFrom)
      if (filterDateTo) params.set("dateTo", filterDateTo)
      params.set("page", String(page))
      params.set("pageSize", String(pageSize))

      const res = await fetch(`/api/events?${params}`)
      if (!res.ok) throw new Error("Failed")
      const data = await res.json()
      setEvents(data.events)
      setTotal(data.total)
    } catch {
      toast.error("Failed to load events")
    } finally {
      setLoading(false)
    }
  }, [
    filterCity,
    filterLocation,
    filterStatus,
    filterHasContact,
    search,
    filterDateFrom,
    filterDateTo,
    page,
    pageSize,
  ])

  const fetchLocations = useCallback(async () => {
    const res = await fetch("/api/locations")
    if (res.ok) setLocations(await res.json())
  }, [])

  useEffect(() => {
    fetchLocations()
  }, [fetchLocations])

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.eventsMissingContacts !== undefined) {
          setEventsMissingContacts(data.eventsMissingContacts)
        }
        if (data.eventsWithContacts !== undefined) {
          setEventsWithContacts(data.eventsWithContacts)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  console.log("Events",events)
  // ── Excel Export ──────────────────────────────────────────────────────────

  const exportToExcel = () => {
    const params = new URLSearchParams()
    if (filterDateFrom) params.set("dateFrom", filterDateFrom)
    if (filterDateTo) params.set("dateTo", filterDateTo)
    if (!filterDateFrom && !filterDateTo) {
      if (exportMonth !== "all") params.set("month", exportMonth)
      if (exportYear) params.set("year", exportYear)
    }
    const qs = params.toString()
    window.open(`/api/events/export${qs ? `?${qs}` : ""}`, "_blank")
    toast.success("Exporting events...")
  }

  // ── Find All Contacts ─────────────────────────────────────────────────────

  const refreshStats = () => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.eventsMissingContacts !== undefined)
          setEventsMissingContacts(data.eventsMissingContacts)
        if (data.eventsWithContacts !== undefined)
          setEventsWithContacts(data.eventsWithContacts)
      })
      .catch(() => {})
  }

  const handleFindAllContacts = async () => {
    setFindAllLoading(true)
    toast.info("Finding contacts for all events missing contact info...")

    try {
      const res = await fetch("/api/events/find-all-contacts", {
        method: "POST",
      })
      const data = await res.json()
      toast.success(
        `Done: ${data.found} contacts found out of ${data.processed} events`
      )
      fetchEvents()
      refreshStats()
    } catch {
      toast.error("Failed to find contacts")
    } finally {
      setFindAllLoading(false)
    }
  }

  const handleDeleteAll = async () => {
    if (!confirm(`Delete all ${total} events? This cannot be undone.`)) return
    setDeleteAllLoading(true)
    try {
      const res = await fetch("/api/events", { method: "DELETE" })
      if (!res.ok) throw new Error()
      const data = await res.json()
      toast.success(`Deleted ${data.deleted} events`)
      setPage(1)
      fetchEvents()
      refreshStats()
    } catch {
      toast.error("Failed to delete events")
    } finally {
      setDeleteAllLoading(false)
    }
  }

  const handleRunSearch = async () => {
    setSearchRunning(true)
    const clientRunId = crypto.randomUUID()
    setProgressTitle("Running Search Pipeline")
    setProgressRunId(clientRunId)
    try {
      const body: Record<string, any> = { forceRefresh, clientRunId }
      if (filterDateFrom) body.dateFrom = filterDateFrom
      if (filterDateTo) body.dateTo = filterDateTo
      if (filterLocation !== "all") body.locationIds = [filterLocation]
      else if (filterCity !== "all") {
        const cityLocs = locations.filter((l) => l.parentId === filterCity || l.id === filterCity)
        if (cityLocs.length > 0) body.locationIds = cityLocs.map((l) => l.id)
      }

      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? "Search failed")
        return
      }

      setProgressTitle("Search Complete")

      const parts = [`${data.recordsNew} new events found (${data.recordsFound} total scanned)`]
      toast.success(parts.join(" · "))

      if (data.warnings?.length > 0) {
        const uniqueWarnings = [...new Set(data.warnings)]
        toast.warning(`Provider issues: ${uniqueWarnings.slice(0, 3).join("; ")}${uniqueWarnings.length > 3 ? ` (+${uniqueWarnings.length - 3} more)` : ""}`)
      }

      fetchEvents()
      refreshStats()
    } catch {
      toast.error("Search request failed")
    } finally {
      setSearchRunning(false)
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const isPast = (row: EventRow) => {
    const d = row.eventDateEnd ?? row.eventDateStart
    if (!d) return false
    return new Date(d) < new Date()
  }

  // ── Columns ───────────────────────────────────────────────────────────────

  const columns: ColumnDef<EventRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "eventName",
        header: "Event Name",
        cell: ({ row }) => (
          <div className="max-w-[300px]">
            <p className="truncate text-sm font-medium">
              {row.original.eventName}
            </p>
            {row.original.sourceUrl && (
              <a
                href={row.original.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate text-xs text-muted-foreground hover:underline"
              >
                {row.original.sourceUrl}
              </a>
            )}
          </div>
        ),
      },
      {
        id: "location",
        header: "Location",
        accessorFn: (row) => row.location.name,
        cell: ({ row }) => (
          <span className="text-sm">
            {row.original.location.name}
            {row.original.location.city && (
              <span className="text-muted-foreground">
                , {row.original.location.city}
              </span>
            )}
          </span>
        ),
      },
      {
        id: "contacts",
        header: "Contacts",
        cell: ({ row }) => {
          const event = row.original
          const contacts = event.contacts ?? []
          const primary = contacts.find((c) => c.isPrimary)
          if (contacts.length === 0) {
            return (
              <span className="text-xs text-muted-foreground italic">
                No contacts
              </span>
            )
          }
          return (
            <div className="max-w-[280px]">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {primary?.name ?? contacts[0].name}
                </span>
                {contacts.length > 1 && (
                  <Badge variant="neutral" size="sm">
                    +{contacts.length - 1}
                  </Badge>
                )}
              </div>
              {/* {(primary?.title ?? contacts[0].title) && (
                <p className="text-xs text-muted-foreground truncate">
                  {primary?.title ?? contacts[0].title}
                </p>
              )} */}
              {(primary?.email ?? contacts[0].email) && (
                <p className="truncate text-xs">
                  {primary?.email ?? contacts[0].email}
                </p>
              )}
              {(primary?.phone ?? contacts[0].phone) && (
                <p className="truncate text-xs text-muted-foreground">
                  {primary?.phone ?? contacts[0].phone}
                </p>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: "eventDateStart",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-8 px-2"
          >
            Date
            <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        ),
        sortingFn: "datetime",
        cell: ({ row }) => {
          const d = row.original.eventDateStart
          if (!d)
            return <span className="text-sm text-muted-foreground">—</span>
          const start = new Date(d)
          const end = row.original.eventDateEnd
            ? new Date(row.original.eventDateEnd)
            : null
          const fmt = (date: Date) =>
            date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          return (
            <span className="text-sm whitespace-nowrap">
              {end ? `${fmt(start)} – ${fmt(end)}` : fmt(start)}
            </span>
          )
        },
      },
      {
        accessorKey: "expectedAttendees",
        header: "Attendees",
        cell: ({ row }) => {
          const val = row.original.expectedAttendees
          return (
            <span className="text-sm">
              {val != null ? val.toLocaleString() : <span className="text-muted-foreground italic">—</span>}
            </span>
          )
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.status}
            eventId={row.original.id}
            onSaved={fetchEvents}
          />
        ),
      },
      {
        id: "contactNote",
        header: "Notes",
        cell: ({ row }) => (
          <InlineEditCell
            value={row.original.contactNote}
            eventId={row.original.id}
            field="contactNote"
            onSaved={fetchEvents}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { align: "center" },
        cell: ({ row }) => {
          const event = row.original
          const contactCount = event.contacts?.length ?? 0
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <DropdownMenuItem
                  onClick={() =>
                    setContactModal({
                      open: true,
                      eventId: event.id,
                      eventName: event.eventName,
                    })
                  }
                >
                  <Search className="mr-2 h-4 w-4" />
                  {contactCount > 0 ? "View Contacts" : "Find Contact"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ],
    [fetchEvents]
  )

  // ── Table ─────────────────────────────────────────────────────────────────

  const table = useReactTable({
    data: events,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="space-y-3">
        {/* Contact filter tabs */}
        <div className="flex items-center gap-1">
          {[
            { value: "true", label: "With Contact", count: eventsWithContacts },
            {
              value: "false",
              label: "No Contact",
              count: eventsMissingContacts,
            },
            { value: "all", label: "All Events", count: total },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setHasContactFilter(tab.value)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                filterHasContact === tab.value
                  ? "bg-primary font-medium text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-3">
          <Input
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-64"
          />
          <Select value={filterCity} onValueChange={setCityFilter}>
            <SelectTrigger className="w-44" size="sm">
              <SelectValue placeholder="All cities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All cities</SelectItem>
              {locations
                .filter((loc) => loc.type === "CITY")
                .map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={filterLocation} onValueChange={setLocationFilter}>
            <SelectTrigger className="w-56" size="sm">
              <SelectValue placeholder="All venues" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All venues</SelectItem>
              {locations
                .filter((loc) => loc.type === "VENUE")
                .filter(
                  (loc) => filterCity === "all" || loc.parentId === filterCity
                )
                .map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                    {loc.city
                      ? ` (${loc.city}${loc.state ? `, ${loc.state}` : ""})`
                      : ""}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" size="sm">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setDateFromFilter(e.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              title="From date"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <input
              type="date"
              value={filterDateTo}
              onChange={(e) => setDateToFilter(e.target.value)}
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              title="To date"
            />
         
          </div>
          <Select value={exportMonth} onValueChange={setExportMonth}>
            <SelectTrigger className="w-32" size="sm">
              <SelectValue placeholder="All months" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              <SelectItem value="1">January</SelectItem>
              <SelectItem value="2">February</SelectItem>
              <SelectItem value="3">March</SelectItem>
              <SelectItem value="4">April</SelectItem>
              <SelectItem value="5">May</SelectItem>
              <SelectItem value="6">June</SelectItem>
              <SelectItem value="7">July</SelectItem>
              <SelectItem value="8">August</SelectItem>
              <SelectItem value="9">September</SelectItem>
              <SelectItem value="10">October</SelectItem>
              <SelectItem value="11">November</SelectItem>
              <SelectItem value="12">December</SelectItem>
            </SelectContent>
          </Select>
          <Select value={exportYear} onValueChange={setExportYear}>
            <SelectTrigger className="w-24" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="2025">2025</SelectItem>
              <SelectItem value="2026">2026</SelectItem>
              <SelectItem value="2027">2027</SelectItem>
            </SelectContent>
          </Select>
          <Button
              variant="primary"
              size="sm"
              onClick={handleRunSearch}
              disabled={searchRunning}
            >
              {searchRunning ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-4 w-4" />
              )}
              Run Search
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input accent-primary"
              />
              Force refresh
            </label>
          <Button variant="outline" size="sm" onClick={exportToExcel}>
            <Download className="mr-1.5 h-4 w-4" />
            Export
          </Button>
          <Dialog
            open={importOpen}
            onOpenChange={(open) => {
              setImportOpen(open)
              if (!open) {
                setImportFile(null)
                setImportResult(null)
              }
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Upload className="mr-1.5 h-4 w-4" />
                Import
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Import Events from Excel</DialogTitle>
                <DialogDescription>
                  Upload an .xlsx file to batch-create events. Download the
                  sample template first to see the expected format.
                </DialogDescription>
              </DialogHeader>

              {importResult ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-medium text-emerald-600">
                      ✓ {importResult.created} created
                    </span>
                    {importResult.skipped > 0 && (
                      <span className="text-muted-foreground">
                        ↷ {importResult.skipped} skipped
                      </span>
                    )}
                    {importResult.errors > 0 && (
                      <span className="font-medium text-destructive">
                        ✗ {importResult.errors} errors
                      </span>
                    )}
                  </div>
                  {importResult.details.length > 0 && (
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded border p-2 text-xs text-muted-foreground">
                      {importResult.details.map((d, i) => (
                        <p key={i}>{d}</p>
                      ))}
                    </div>
                  )}
                  <DialogFooter showCloseButton />
                </div>
              ) : (
                <div className="space-y-4">
                  <a
                    href="/api/events/import/sample"
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    Download sample template
                  </a>
                  <div
                    className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border-2 border-dashed p-8 text-center transition-colors hover:bg-muted/30"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {importFile
                        ? importFile.name
                        : "Click to select an .xlsx file"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      .xlsx files only
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) setImportFile(f)
                      }}
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      disabled={!importFile || importLoading}
                      onClick={async () => {
                        if (!importFile) return
                        setImportLoading(true)
                        setImportResult(null)
                        try {
                          const fd = new FormData()
                          fd.set("file", importFile)
                          const res = await fetch("/api/events/import", {
                            method: "POST",
                            body: fd,
                          })
                          const data = await res.json()
                          if (!res.ok) throw new Error(data.error)
                          setImportResult(data)
                          fetchEvents()
                          refreshStats()
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Import failed"
                          )
                        } finally {
                          setImportLoading(false)
                        }
                      }}
                    >
                      {importLoading ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : null}
                      Upload & Import
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            size="sm"
            onClick={handleFindAllContacts}
            disabled={findAllLoading || eventsMissingContacts === 0}
          >
            {findAllLoading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-4 w-4" />
            )}
            Find All Contacts ({eventsMissingContacts})
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={handleDeleteAll}
            disabled={deleteAllLoading || total === 0}
          >
            {deleteAllLoading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="mr-1.5 h-4 w-4" />
            )}
            Delete All ({total})
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {events.length > 0
              ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`
              : `${total} events`}
          </span>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id}>
                  {hg.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="h-9 text-xs font-medium"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((_, j) => (
                      <TableCell key={j} className="h-12">
                        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No events found. Run the ingestion job to discover events.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={
                      isPast(row.original)
                        ? "opacity-50 [&_td]:text-muted-foreground"
                        : ""
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Show</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v))
                setPage(1)
              }}
            >
              <SelectTrigger className="h-8 w-16" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span>of {total}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-3 text-sm">
              Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setPage((p) => Math.min(Math.ceil(total / pageSize), p + 1))
              }
              disabled={page >= Math.ceil(total / pageSize)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Progress Dialog */}
      <ProgressDialog
        open={progressRunId !== null}
        title={progressTitle}
        runId={progressRunId}
        onComplete={() => {
          setProgressRunId(null)
          setProgressTitle("")
        }}
      />

      {/* Contact Finder Modal */}
      <ContactFinderModal
        eventId={contactModal.eventId}
        eventName={contactModal.eventName}
        open={contactModal.open}
        onClose={() =>
          setContactModal({ open: false, eventId: "", eventName: "" })
        }
        onSaved={fetchEvents}
      />
    </div>
  )
}
