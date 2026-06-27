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
import { ArrowUpDown, Download, Pencil, Check, X, Search, Loader2 } from "lucide-react"
import { toast } from "sonner"
import * as XLSX from "xlsx"
import { EXCEL_EXPORT_COLUMNS } from "@/lib/constants/events"
import { ContactFinderModal } from "./contact-finder-modal"

// ─── Types ────────────────────────────────────────────────────────────────────

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
    { id: "eventDateStart", desc: false },
  ])

  // Contact finder modal state
  const [contactModal, setContactModal] = useState<{
    open: boolean
    eventId: string
    eventName: string
  }>({ open: false, eventId: "", eventName: "" })
  const [findAllLoading, setFindAllLoading] = useState(false)

  const fetchEvents = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filterLocation !== "all") params.set("locationId", filterLocation)
      if (filterStatus !== "all") params.set("status", filterStatus)
      if (search) params.set("search", search)

      const res = await fetch(`/api/events?${params}`)
      if (!res.ok) throw new Error("Failed")
      setEvents(await res.json())
    } catch {
      toast.error("Failed to load events")
    } finally {
      setLoading(false)
    }
  }, [filterLocation, filterStatus, search])

  const fetchLocations = useCallback(async () => {
    const res = await fetch("/api/locations")
    if (res.ok) setLocations(await res.json())
  }, [])

  useEffect(() => {
    fetchLocations()
  }, [fetchLocations])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  // ── Excel Export ──────────────────────────────────────────────────────────

  const exportToExcel = () => {
    const data = events.map((e) => ({
      "Event Name": e.eventName,
      Location: e.location.name,
      "Contact Name": e.organizerName ?? "",
      "Contact Title": e.organizerTitle ?? "",
      Phone: e.organizerPhone ?? "",
      Email: e.organizerEmail ?? "",
      "Date of Event": e.eventDateStart
        ? new Date(e.eventDateStart).toLocaleDateString("en-US", {
            month: "long",
            day: "numeric",
            year: "numeric",
          })
        : "",
      Status: e.status,
    }))

    const ws = XLSX.utils.json_to_sheet(data, { header: [...EXCEL_EXPORT_COLUMNS] })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Events")
    XLSX.writeFile(wb, `events-export-${new Date().toISOString().slice(0, 10)}.xlsx`)
    toast.success(`Exported ${events.length} events`)
  }

  // ── Find All Contacts ─────────────────────────────────────────────────────

  const handleFindAllContacts = async () => {
    setFindAllLoading(true)
    toast.info("Finding contacts for all events missing contact info...")

    try {
      const res = await fetch("/api/events/find-all-contacts", { method: "POST" })
      const data = await res.json()
      toast.success(`Done: ${data.found} contacts found out of ${data.processed} events`)
      fetchEvents()
    } catch {
      toast.error("Failed to find contacts")
    } finally {
      setFindAllLoading(false)
    }
  }

  const missingContactCount = events.filter((e) => !e.organizerName).length

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
        accessorKey: "organizerName",
        header: "Contact Name",
        cell: ({ row }) => (
          <InlineEditCell
            value={row.original.organizerName}
            eventId={row.original.id}
            field="organizerName"
            onSaved={fetchEvents}
          />
        ),
      },
      {
        accessorKey: "organizerTitle",
        header: "Contact Title",
        cell: ({ row }) => (
          <InlineEditCell
            value={row.original.organizerTitle}
            eventId={row.original.id}
            field="organizerTitle"
            onSaved={fetchEvents}
          />
        ),
      },
      {
        accessorKey: "organizerPhone",
        header: "Phone",
        cell: ({ row }) => (
          <InlineEditCell
            value={row.original.organizerPhone}
            eventId={row.original.id}
            field="organizerPhone"
            onSaved={fetchEvents}
          />
        ),
      },
      {
        accessorKey: "organizerEmail",
        header: "Email",
        cell: ({ row }) => (
          <InlineEditCell
            value={row.original.organizerEmail}
            eventId={row.original.id}
            field="organizerEmail"
            onSaved={fetchEvents}
          />
        ),
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
          const hasContact = !!event.organizerName
          return (
            <Button
              variant={hasContact ? "ghost" : "outline"}
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
              {hasContact ? "Find Better" : "Find Contact"}
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
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search events..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Select value={filterLocation} onValueChange={setFilterLocation}>
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
        <Select value={filterStatus} onValueChange={setFilterStatus}>
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
        <Button variant="outline" size="sm" onClick={exportToExcel}>
          <Download className="h-4 w-4 mr-1.5" />
          Export to Excel
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleFindAllContacts}
          disabled={findAllLoading || missingContactCount === 0}
        >
          {findAllLoading ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <Search className="h-4 w-4 mr-1.5" />
          )}
          Find All Contacts ({missingContactCount})
        </Button>
        <span className="text-xs text-muted-foreground ml-auto">
          {events.length} events
        </span>
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
