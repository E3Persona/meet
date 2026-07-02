"use client"

import React, { useState, useCallback, useEffect, useMemo } from "react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { ArrowUpDown, Download, Pencil, Check, X, Search, Loader2, Trash2, ChevronLeft, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { ContactFinderModal } from "./contact-finder-modal"

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
  sourceUrl: string | null
  organizerName: string | null
  organizerTitle: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  status: "new" | "reviewed" | "contacted"
  dateAdded: string
  location: { name: string; city: string | null; state: string | null }
  contacts: EventContact[]
}

interface Location {
  id: string
  name: string
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
        className="group flex items-center gap-1 text-sm hover:bg-muted/50 rounded px-1 py-0.5 -mx-1 cursor-pointer"
      >
        <span className={value ? "" : "text-muted-foreground italic"}>
          {value || "Add..."}
        </span>
        <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
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
    STATUS_CONFIG[currentStatus as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.new

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
  const [filterLocation, setFilterLocation] = useState<string>("all")
  const [filterStatus, setFilterStatus] = useState<string>("all")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "eventDateStart", desc: true },
  ])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [total, setTotal] = useState(0)
  const [filterHasContact, setFilterHasContact] = useState<string>("true")
  const [exportMonth, setExportMonth] = useState<string>("all")
  const [exportYear, setExportYear] = useState<string>(String(new Date().getFullYear()))

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

  const setLocationFilter = (val: string) => { setFilterLocation(val); setPage(1) }
  const setStatusFilter = (val: string) => { setFilterStatus(val); setPage(1) }
  const setSearchFilter = (val: string) => { setSearch(val); setPage(1) }
  const setHasContactFilter = (val: string) => { setFilterHasContact(val); setPage(1) }

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterLocation !== "all") params.set("locationId", filterLocation)
      if (filterStatus !== "all") params.set("status", filterStatus)
      if (filterHasContact !== "all") params.set("hasContact", filterHasContact)
      if (search) params.set("search", search)
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
  }, [filterLocation, filterStatus, filterHasContact, search, page, pageSize])

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

  // ── Excel Export ──────────────────────────────────────────────────────────

  const exportToExcel = () => {
    const params = new URLSearchParams()
    if (exportMonth !== "all") params.set("month", exportMonth)
    if (exportYear) params.set("year", exportYear)
    const qs = params.toString()
    window.open(`/api/events/export${qs ? `?${qs}` : ""}`, "_blank")
    toast.success("Exporting events...")
  }

  // ── Find All Contacts ─────────────────────────────────────────────────────

  const refreshStats = () => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.eventsMissingContacts !== undefined) setEventsMissingContacts(data.eventsMissingContacts)
        if (data.eventsWithContacts !== undefined) setEventsWithContacts(data.eventsWithContacts)
      })
      .catch(() => {})
  }

  const handleFindAllContacts = async () => {
    setFindAllLoading(true)
    toast.info("Finding contacts for all events missing contact info...")

    try {
      const res = await fetch("/api/events/find-all-contacts", { method: "POST" })
      const data = await res.json()
      toast.success(`Done: ${data.found} contacts found out of ${data.processed} events`)
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

  // ── Columns ───────────────────────────────────────────────────────────────

  const columns: ColumnDef<EventRow, unknown>[] = useMemo(
    () => [
      {
        accessorKey: "eventName",
        header: "Event Name",
        cell: ({ row }) => (
          <div className="max-w-[300px]">
            <p className="text-sm font-medium truncate">{row.original.eventName}</p>
            {row.original.sourceUrl && (
              <a
                href={row.original.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:underline truncate block"
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
              <span className="text-xs text-muted-foreground italic">No contacts</span>
            )
          }
          return (
            <div className="max-w-[280px]">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{primary?.name ?? contacts[0].name}</span>
                {contacts.length > 1 && (
                  <Badge variant="neutral" size="sm">+{contacts.length - 1}</Badge>
                )}
              </div>
              {(primary?.title ?? contacts[0].title) && (
                <p className="text-xs text-muted-foreground truncate">
                  {primary?.title ?? contacts[0].title}
                </p>
              )}
              {(primary?.email ?? contacts[0].email) && (
                <p className="text-xs truncate">
                  {primary?.email ?? contacts[0].email}
                </p>
              )}
              {(primary?.phone ?? contacts[0].phone) && (
                <p className="text-xs text-muted-foreground truncate">
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
          if (!d) return <span className="text-muted-foreground text-sm">—</span>
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
        id: "actions",
        header: "",
        meta: { align: "center" },
        cell: ({ row }) => {
          const event = row.original
          const contactCount = event.contacts?.length ?? 0
          return (
            <Button
              variant={contactCount > 0 ? "ghost" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                setContactModal({
                  open: true,
                  eventId: event.id,
                  eventName: event.eventName,
                })
              }
            >
              <Search className="h-3 w-3 mr-1" />
              {contactCount > 0 ? `${contactCount} Contact${contactCount > 1 ? "s" : ""}` : "Find Contact"}
            </Button>
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
            { value: "false", label: "No Contact", count: eventsMissingContacts },
            { value: "all", label: "All Events", count: total },
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setHasContactFilter(tab.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                filterHasContact === tab.value
                  ? "bg-primary text-primary-foreground font-medium"
                  : "bg-muted text-muted-foreground hover:bg-muted/80"
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Filters row */}
        <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearchFilter(e.target.value)}
          className="w-64"
        />
        <Select value={filterLocation} onValueChange={setLocationFilter}>
          <SelectTrigger className="w-48" size="sm">
            <SelectValue placeholder="All locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All locations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.name}
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
        <Button variant="outline" size="sm" onClick={exportToExcel}>
          <Download className="h-4 w-4 mr-1.5" />
          Export to Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFindAllContacts}
          disabled={findAllLoading || eventsMissingContacts === 0}
        >
          {findAllLoading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Search className="h-4 w-4 mr-1.5" />
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
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-1.5" />
          )}
          Delete All ({total})
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
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
                        <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
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
            <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1) }}>
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
            <span className="text-sm px-3">
              Page {page} of {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(Math.ceil(total / pageSize), p + 1))}
              disabled={page >= Math.ceil(total / pageSize)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Finder Modal */}
      <ContactFinderModal
        eventId={contactModal.eventId}
        eventName={contactModal.eventName}
        open={contactModal.open}
        onClose={() => setContactModal({ open: false, eventId: "", eventName: "" })}
        onSaved={fetchEvents}
      />
    </div>
  )
}
