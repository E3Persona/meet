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
  MoreHorizontal,
  FileText,
  StickyNote,
  Mail,
  Phone,
} from "lucide-react"
import { toast } from "sonner"
import { ContactFinderModal } from "./contact-finder-modal"
import { ProgressDialog } from "@/components/ui/progress-dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

type EventMetadata = Record<string, unknown>

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
  metadata: EventMetadata
  metadataUpdatedAt: string | null
  rawVenueText: string | null
  rawLocationText: string | null
  venueId: string | null
  venue: { id: string; name: string; city: string | null; state: string | null; address: string | null } | null
  organizerName: string | null
  organizerTitle: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  contactNote: string | null
  status: "new" | "reviewed" | "contacted"
  dateAdded: string
  location: { name: string; city: string | null; state: string | null; type: string }
  contacts: EventContact[]
  notes?: { id: string; content: string; noteType: string; notedAt: string }[]
}

interface Location {
  id: string
  name: string
  type: "STATE" | "DISTRICT" | "CITY" | "VENUE"
  city: string | null
  state: string | null
  parentId: string | null
  parent: { id: string; name: string; type: string } | null
}

// ─── Truncated Cell ────────────────────────────────────────────────────────────

const NOTE_TYPE_LABELS: Record<string, string> = {
  general: "General",
  contact_attempt: "Contact Attempt",
  follow_up: "Follow Up",
  status_change: "Status Change",
  venue_update: "Venue Update",
  research: "Research",
  other: "Other",
}

function TruncatedCell({ text, maxChars = 40 }: { text: string; maxChars?: number }) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = text.length > maxChars
  const display = expanded || !needsTruncation ? text : text.slice(0, maxChars) + "…"
  return (
    <>
      <span className="text-sm">{display}</span>
      {needsTruncation && (
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="ml-1 text-[10px] text-primary hover:underline whitespace-nowrap"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </>
  )
}

// ─── Description Preview ──────────────────────────────────────────────────────

function DescriptionPreview({
  text,
  maxChars = 80,
  onOpen,
}: {
  text: string
  maxChars?: number
  onOpen: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const needsTruncation = text.length > maxChars

  return (
    <div className="max-w-[280px]">
      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
        {expanded ? text : text.slice(0, maxChars)}
        {needsTruncation && !expanded && "…"}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {needsTruncation && (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="text-[10px] text-primary hover:underline"
          >
            {expanded ? "show less" : "read full"}
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className="text-[10px] text-muted-foreground hover:text-foreground hover:underline"
        >
          edit
        </button>
      </div>
    </div>
  )
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
    { id: "eventDateStart", desc: false },
  ])
  const [total, setTotal] = useState(0)
  const [filterHasContact, setFilterHasContact] = useState<string>("all")
  const [filterDateFrom, setFilterDateFrom] = useState<string>("")
  const [filterDateTo, setFilterDateTo] = useState<string>("")
  const [exportMonth, setExportMonth] = useState<string>("all")
  const [exportYear, setExportYear] = useState<string>(
    String(new Date().getFullYear())
  )
  const [pushingToSheet, setPushingToSheet] = useState(false)

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
  const [notesDialog, setNotesDialog] = useState<{
    open: boolean
    eventId: string
    eventName: string
  }>({ open: false, eventId: "", eventName: "" })
  const [dialogNotes, setDialogNotes] = useState<{ id: string; content: string; noteType: string; notedAt: string }[]>([])
  const [dialogNotesLoading, setDialogNotesLoading] = useState(false)
  const [newNoteContent, setNewNoteContent] = useState("")
  const [newNoteType, setNewNoteType] = useState("general")
  const [addingNote, setAddingNote] = useState(false)
  const [metadataDialog, setMetadataDialog] = useState<{
    open: boolean
    eventId: string
    eventName: string
  }>({ open: false, eventId: "", eventName: "" })
  const [metadataDraft, setMetadataDraft] = useState("{}")
  const [savingMetadata, setSavingMetadata] = useState(false)

  const fetchDialogNotes = useCallback(async (eventId: string) => {
    if (!eventId) return
    setDialogNotesLoading(true)
    try {
      const res = await fetch(`/api/events/${eventId}/notes`)
      if (res.ok) setDialogNotes(await res.json())
    } catch { /* ignore */ } finally {
      setDialogNotesLoading(false)
    }
  }, [])

  const openNotes = useCallback((eventId: string, eventName: string) => {
    setNotesDialog({ open: true, eventId, eventName })
    fetchDialogNotes(eventId)
  }, [fetchDialogNotes])

  const openMetadata = useCallback((event: EventRow) => {
    setMetadataDialog({
      open: true,
      eventId: event.id,
      eventName: event.eventName,
    })
    setMetadataDraft(JSON.stringify(event.metadata ?? {}, null, 2))
  }, [])

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
  ])

  const saveMetadata = useCallback(async () => {
    let metadata: EventMetadata
    try {
      const parsed: unknown = JSON.parse(metadataDraft)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("Metadata must be a JSON object")
      }
      metadata = parsed as EventMetadata
    } catch {
      toast.error("Metadata must be a valid JSON object")
      return
    }

    setSavingMetadata(true)
    try {
      const res = await fetch(`/api/events/${metadataDialog.eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata }),
      })
      if (!res.ok) throw new Error("Failed to update metadata")
      toast.success("Event metadata saved")
      setMetadataDialog((current) => ({ ...current, open: false }))
      fetchEvents()
    } catch {
      toast.error("Failed to save event metadata")
    } finally {
      setSavingMetadata(false)
    }
  }, [fetchEvents, metadataDialog.eventId, metadataDraft])

  const setCityFilter = (val: string) => {
    setFilterCity(val)
    setFilterLocation("all")
  }
  const setLocationFilter = (val: string) => {
    setFilterLocation(val)
  }
  const setStatusFilter = (val: string) => {
    setFilterStatus(val)
  }
  const setSearchFilter = (val: string) => {
    setSearch(val)
  }
  const setHasContactFilter = (val: string) => {
    setFilterHasContact(val)
  }
  const setDateFromFilter = (val: string) => {
    setFilterDateFrom(val)
  }
  const setDateToFilter = (val: string) => {
    setFilterDateTo(val)
  }

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

  console.log("Events", events)
  // ── Push to Google Sheet ─────────────────────────────────────────────────

  const pushToSheet = async () => {
    setPushingToSheet(true)
    toast.info("Pushing events to Google Sheet...")
    try {
      const res = await fetch("/api/events/export-sheet", {
        method: "POST",
        headers: { Authorization: `Bearer e3e-v1-gs-sync-key-2025` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed")
      toast.success(`Pushed ${data.pushed} events to Google Sheet`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Push to sheet failed")
    } finally {
      setPushingToSheet(false)
    }
  }

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
        const cityLocs = locations.filter(
          (l) => l.parentId === filterCity || l.id === filterCity
        )
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

      const parts = [
        `${data.recordsNew} new events found (${data.recordsFound} total scanned)`,
      ]
      toast.success(parts.join(" · "))

      if (data.warnings?.length > 0) {
        const uniqueWarnings = [...new Set(data.warnings)]
        toast.warning(
          `Provider issues: ${uniqueWarnings.slice(0, 3).join("; ")}${uniqueWarnings.length > 3 ? ` (+${uniqueWarnings.length - 3} more)` : ""}`
        )
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

  const currentYear = new Date().getFullYear()

  const isOldYear = (row: EventRow) => {
    const d = row.eventDateStart
    if (!d) return false
    return new Date(d).getFullYear() < currentYear
  }

  const isPast = (row: EventRow) => {
    if (isOldYear(row)) return true
    const d = row.eventDateEnd ?? row.eventDateStart
    if (!d) return false
    return new Date(d) < new Date()
  }

  // ── Columns ───────────────────────────────────────────────────────────────

  const maxContacts = useMemo(
    () => Math.max(0, ...events.map((e) => (e.contacts?.length ?? 0))),
    [events]
  )

  const columns: ColumnDef<EventRow, unknown>[] = useMemo(
    () => {
      const baseColumns: ColumnDef<EventRow, unknown>[] = [
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
          cell: ({ row }) => {
            const ev = row.original
            const matchedCity = ev.location.city || ev.location.name
            const matchedState = ev.location.state
            const matchedText = `${matchedCity}${matchedState ? `, ${matchedState}` : ""}`
            const raw = ev.rawLocationText
            const showRaw = raw && raw !== matchedText
            return (
              <div className="max-w-[180px]">
                {showRaw && (
                  <p className="text-xs text-muted-foreground truncate" title={raw}>
                    {raw}
                  </p>
                )}
                <p className={`text-sm ${showRaw ? "text-foreground" : ""}`}>
                  <TruncatedCell text={showRaw ? matchedText : (raw ?? matchedText)} />
                  {showRaw && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground/50 italic">
                      matched
                    </span>
                  )}
                </p>
              </div>
            )
          },
        },
        {
          accessorKey: "rawVenueText",
          header: "Venue",
          cell: ({ row }) => {
            const ev = row.original
            const raw = ev.rawVenueText
            const venue = ev.venue
            const showRaw = raw && venue && raw !== venue.name
            return (
              <div className="max-w-[200px]">
                {showRaw && (
                  <p className="text-xs text-muted-foreground truncate" title={raw}>
                    {raw}
                  </p>
                )}
                {venue ? (
                  <>
                    <p className="text-sm font-medium">
                      <TruncatedCell text={venue.name} />
                      {showRaw && (
                        <span className="ml-1.5 text-[10px] text-muted-foreground/50 italic">
                          matched
                        </span>
                      )}
                    </p>
                    {venue.city && (
                      <p className="text-xs text-muted-foreground">
                        {venue.city}{venue.state ? `, ${venue.state}` : ""}
                      </p>
                    )}
                    {venue.address && (
                      <p className="text-xs text-muted-foreground truncate">
                        {venue.address}
                      </p>
                    )}
                  </>
                ) : raw ? (
                  <p className="text-sm">
                    <TruncatedCell text={raw} />
                    <span className="ml-1.5 text-[10px] text-muted-foreground/50 italic">
                      raw
                    </span>
                  </p>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
            )
          },
        },
      ]

      // Dynamic contact columns: Contact 1 Name, Contact 1 Email, Contact 1 Phone, ...
      for (let i = 0; i < maxContacts; i++) {
        const idx = i
        baseColumns.push({
          id: `contact_${idx}_name`,
          header: `C${idx + 1} Name`,
          cell: ({ row }) => {
            const c = row.original.contacts?.[idx]
            if (!c) return <span className="text-muted-foreground">—</span>
            return (
              <span className="text-xs font-medium truncate block max-w-[140px]" title={c.name}>
                {c.name}
              </span>
            )
          },
        })
        baseColumns.push({
          id: `contact_${idx}_email`,
          header: `C${idx + 1} Email`,
          cell: ({ row }) => {
            const c = row.original.contacts?.[idx]
            if (!c?.email) return <span className="text-muted-foreground">—</span>
            return (
              <a
                href={`mailto:${c.email}`}
                className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary max-w-[160px]"
                title={c.email}
              >
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{c.email}</span>
              </a>
            )
          },
        })
        baseColumns.push({
          id: `contact_${idx}_phone`,
          header: `C${idx + 1} Phone`,
          cell: ({ row }) => {
            const c = row.original.contacts?.[idx]
            if (!c?.phone) return <span className="text-muted-foreground">—</span>
            return (
              <a
                href={`tel:${c.phone}`}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                title={c.phone}
              >
                <Phone className="h-3 w-3 shrink-0" />
                <span className="truncate">{c.phone}</span>
              </a>
            )
          },
        })
      }

      baseColumns.push(
        {
          accessorKey: "eventDateStart",
          header: ({ column }) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
              className="h-8 px-2"
            >
              Start Date
              <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          ),
          sortingFn: "datetime",
          cell: ({ row }) => {
            if (isOldYear(row.original))
              return <span className="text-sm text-muted-foreground">—</span>
            const d = row.original.eventDateStart
            if (!d)
              return <span className="text-sm text-muted-foreground">—</span>
            const start = new Date(d)
            const fmt = (date: Date) =>
              date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            return (
              <span className="text-sm whitespace-nowrap">
                {fmt(start)}
              </span>
            )
          },
        },
        {
          accessorKey: "eventDateEnd",
          header: ({ column }) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
              className="h-8 px-2"
            >
              End Date
              <ArrowUpDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          ),
          sortingFn: "datetime",
          cell: ({ row }) => {
            if (isOldYear(row.original))
              return <span className="text-sm text-muted-foreground">—</span>
            const d = row.original.eventDateEnd
            if (!d)
              return <span className="text-sm text-muted-foreground">—</span>
            const end = new Date(d)
            const fmt = (date: Date) =>
              date.toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })
            return (
              <span className="text-sm whitespace-nowrap">
                {fmt(end)}
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
                {val != null ? (
                  val.toLocaleString()
                ) : (
                  <span className="text-muted-foreground italic">—</span>
                )}
              </span>
            )
          },
        },
        {
          id: "metadata",
          header: "Description",
          cell: ({ row }) => {
            const metadata = row.original.metadata ?? {}
            const fullDesc = (metadata as Record<string, unknown>).fullDescription
            if (typeof fullDesc !== "string" || !fullDesc) {
              return (
                <button
                  type="button"
                  onClick={() => openMetadata(row.original)}
                  className="group -mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-sm hover:bg-muted/50"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
                  <span className="text-muted-foreground italic">Add details</span>
                  <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </button>
              )
            }
            return (
              <DescriptionPreview
                text={fullDesc}
                onOpen={() => openMetadata(row.original)}
              />
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
          id: "notes",
          header: "Notes",
          cell: ({ row }) => {
            const event = row.original
            const notes = event.notes ?? []
            const notesCount = notes.length
            const lastNote = notesCount > 0 ? notes[notesCount - 1] : null
            return (
              <button
                type="button"
                onClick={() =>
                  openNotes(event.id, event.eventName)
                }
                className="group -mx-1 flex cursor-pointer items-start gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted/50"
              >
                <StickyNote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                <div className="min-w-0 flex-1">
                  {lastNote ? (
                    <p className="text-xs leading-tight text-muted-foreground line-clamp-2">
                      {lastNote.content}
                    </p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground/50">
                      No notes
                    </p>
                  )}
                </div>
                {notesCount > 0 && (
                  <Badge variant="info" size="sm" className="mt-0.5 shrink-0">
                    {notesCount}
                  </Badge>
                )}
              </button>
            )
          },
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
                  <DropdownMenuItem
                    onClick={() =>
                      openNotes(event.id, event.eventName)
                    }
                  >
                    <StickyNote className="mr-2 h-4 w-4" />
                    View Notes
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          },
        },
      )

      return baseColumns
    },
    [fetchEvents, maxContacts, openMetadata]
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
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground select-none">
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
          <Button
            variant="outline"
            size="sm"
            onClick={pushToSheet}
            disabled={pushingToSheet || total === 0}
          >
            {pushingToSheet ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            Push to Sheet
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
          {/* <Button
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
          </Button> */}
          <span className="ml-auto text-xs text-muted-foreground">
            {total} events
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

      {/* Notes Dialog */}
      <Dialog open={notesDialog.open} onOpenChange={(open) => setNotesDialog({ ...notesDialog, open })}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Notes - {notesDialog.eventName}</DialogTitle>
            <DialogDescription>
              {dialogNotes.length} note(s) recorded
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col gap-3 min-h-0">
            {/* Notes list */}
            <div className="flex-1 overflow-y-auto space-y-2 min-h-0 max-h-64">
              {dialogNotesLoading ? (
                <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
              ) : dialogNotes.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground italic">No notes yet</p>
              ) : (
                [...dialogNotes].reverse().map((note) => (
                  <div key={note.id} className="rounded-md border border-border/50 bg-muted/20 p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="neutral" size="sm">
                        {NOTE_TYPE_LABELS[note.noteType] ?? note.noteType}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(note.notedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{note.content}</p>
                  </div>
                ))
              )}
            </div>
            {/* Add note */}
            <div className="border-t border-border pt-3 space-y-2">
              <label className="text-sm font-medium">Add Note</label>
              <Textarea
                placeholder="What happened? (e.g., Called organizer, left voicemail, sent follow-up email...)"
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                rows={2}
              />
              <div className="flex items-center gap-2">
                <Select value={newNoteType} onValueChange={setNewNoteType}>
                  <SelectTrigger className="w-40" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="general">General</SelectItem>
                    <SelectItem value="contact_attempt">Contact Attempt</SelectItem>
                    <SelectItem value="follow_up">Follow Up</SelectItem>
                    <SelectItem value="status_change">Status Change</SelectItem>
                    <SelectItem value="venue_update">Venue Update</SelectItem>
                    <SelectItem value="research">Research</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!newNoteContent.trim()) return
                    setAddingNote(true)
                    try {
                      const res = await fetch(`/api/events/${notesDialog.eventId}/notes`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          content: newNoteContent,
                          noteType: newNoteType,
                          notedAt: new Date().toISOString(),
                        }),
                      })
                      if (!res.ok) throw new Error("Failed to add note")
                      toast.success("Note added")
                      setNewNoteContent("")
                      setNewNoteType("general")
                      fetchDialogNotes(notesDialog.eventId)
                      fetchEvents()
                    } catch {
                      toast.error("Failed to add note")
                    } finally {
                      setAddingNote(false)
                    }
                  }}
                  disabled={!newNoteContent.trim() || addingNote}
                >
                  {addingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add Note"}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      {/* Event metadata dialog */}
      <Dialog
        open={metadataDialog.open}
        onOpenChange={(open) =>
          setMetadataDialog((current) => ({ ...current, open }))
        }
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Event Metadata — {metadataDialog.eventName}</DialogTitle>
            <DialogDescription>
              Add any structured event details as a JSON object. These details are entered manually.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Event metadata JSON"
            value={metadataDraft}
            onChange={(event) => setMetadataDraft(event.target.value)}
            rows={16}
            className="font-mono text-xs"
            spellCheck={false}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setMetadataDialog((current) => ({ ...current, open: false }))
              }
              disabled={savingMetadata}
            >
              Cancel
            </Button>
            <Button onClick={saveMetadata} loading={savingMetadata}>
              Save metadata
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
