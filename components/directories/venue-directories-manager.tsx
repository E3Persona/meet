"use client"

import React, { useState, useCallback, useEffect, startTransition } from "react"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Checkbox,
} from "@/components/ui/checkbox"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  ExternalLink,
  RefreshCw,
  Pencil,
  Trash2,
  CheckCircle,
  AlertCircle,
  XCircle,
  HelpCircle,
  Loader2,
  Search,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type HealthStatus = "unconfirmed" | "valid" | "suggested_correction" | "broken"
type FetchStrategy = "jina_markdown" | "puppeteer_html"

interface VenueSourceRow {
  id: string
  sourceUrl: string
  strategy: FetchStrategy
  isActive: boolean
  healthStatus: HealthStatus
  suggestedUrl: string | null
  discoveryMethod: string | null
  discoveryConfidence: number | null
  lastScrapedAt: string | null
  batchSize: number
  batchDelayMs: number
  venue: { id: string; name: string; city: string | null; state: string | null; address: string | null }
  directory: { id: string; baseUrl: string; name: string }
}

const HEALTH_CONFIG: Record<HealthStatus, { label: string; variant: "neutral" | "success" | "warning" | "error"; icon: React.ComponentType<{ className?: string }> }> = {
  unconfirmed: { label: "Unconfirmed", variant: "neutral", icon: HelpCircle },
  valid: { label: "Valid", variant: "success", icon: CheckCircle },
  suggested_correction: { label: "Suggestion", variant: "warning", icon: AlertCircle },
  broken: { label: "Broken", variant: "error", icon: XCircle },
}

const HEALTH_FILTERS: { value: HealthStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unconfirmed", label: "Unconfirmed" },
  { value: "valid", label: "Valid" },
  { value: "suggested_correction", label: "Suggestions" },
  { value: "broken", label: "Broken" },
]

export function VenueDirectoriesManager() {
  const [rows, setRows] = useState<VenueSourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [healthFilter, setHealthFilter] = useState<HealthStatus | "all">("all")
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState("")
  const [editRow, setEditRow] = useState<VenueSourceRow | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (healthFilter !== "all") params.set("health", healthFilter)
      if (!showInactive) params.set("active", "true")
      const res = await fetch(`/api/venue-directories?${params}`)
      if (!res.ok) throw new Error("Failed to fetch")
      setRows(await res.json())
    } catch {
      toast.error("Failed to load venue directories")
    } finally {
      setLoading(false)
    }
  }, [healthFilter, showInactive])

  useEffect(() => {
    startTransition(() => { fetchRows() })
  }, [fetchRows])

  const filtered = search.trim()
    ? rows.filter((r) =>
        r.venue.name.toLowerCase().includes(search.toLowerCase()) ||
        r.sourceUrl.toLowerCase().includes(search.toLowerCase()) ||
        r.directory.baseUrl.toLowerCase().includes(search.toLowerCase())
      )
    : rows

  const columns: ColumnDef<VenueSourceRow, unknown>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected() ? true : table.getIsSomeRowsSelected() ? "indeterminate" : false}
          onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Select ${row.original.venue.name}`}
        />
      ),
      size: 40,
    },
    {
      accessorKey: "venue",
      header: "Venue",
      cell: ({ row }) => {
        const v = row.original.venue
        return (
          <div>
            <p className="font-medium text-sm">{v.name}</p>
            <p className="text-xs text-muted-foreground">{[v.city, v.state].filter(Boolean).join(", ")}</p>
            {v.address && (
              <p className="text-xs text-muted-foreground/70">{v.address}</p>
            )}
          </div>
        )
      },
      size: 200,
    },
    {
      accessorKey: "directory.baseUrl",
      header: "Directory",
      cell: ({ row }) => (
        <div className="max-w-[180px]">
          <p className="text-xs text-muted-foreground truncate" title={row.original.directory.baseUrl}>
            {row.original.directory.baseUrl.replace(/\/+$/, "")}
          </p>
        </div>
      ),
      size: 180,
    },
    {
      accessorKey: "sourceUrl",
      header: "Source URL",
      cell: ({ row }) => (
        <div className="max-w-[280px]">
          <a
            href={row.original.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs hover:underline break-all"
          >
            {row.original.sourceUrl}
            <ExternalLink className="h-3 w-3 inline ml-1" />
          </a>
          {row.original.suggestedUrl && (
            <div className="mt-1">
              <span className="text-xs text-amber-600">Suggest: </span>
              <span className="text-xs text-muted-foreground truncate">{row.original.suggestedUrl}</span>
            </div>
          )}
        </div>
      ),
      size: 280,
    },
    {
      accessorKey: "healthStatus",
      header: "Health",
      cell: ({ row }) => {
        const h = row.original.healthStatus as HealthStatus
        const cfg = HEALTH_CONFIG[h]
        const Icon = cfg.icon
        return (
          <Badge variant={cfg.variant} size="sm" className="gap-1">
            <Icon className="h-3 w-3" />
            {cfg.label}
          </Badge>
        )
      },
      size: 120,
    },
    {
      accessorKey: "isActive",
      header: "Active",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.original.isActive}
            size="sm"
            onCheckedChange={async (v) => {
              await patchRow(row.original.id, { isActive: v })
            }}
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-xs text-muted-foreground">{row.original.isActive ? "Yes" : "No"}</span>
        </div>
      ),
      size: 100,
    },
    {
      accessorKey: "lastScrapedAt",
      header: "Last Scraped",
      cell: ({ row }) => {
        if (!row.original.lastScrapedAt) return <span className="text-xs text-muted-foreground">Never</span>
        return (
          <span className="text-xs text-muted-foreground">
            {new Date(row.original.lastScrapedAt).toLocaleDateString()}
          </span>
        )
      },
      size: 110,
    },
  ]

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: true,
    state: { rowSelection: {} },
    onRowSelectionChange: (upd) => {
      const next = typeof upd === "function" ? upd({}) : upd
      setSelectedIds(new Set(Object.keys(next)))
    },
  })

  const patchRow = async (id: string, data: Record<string, unknown>) => {
    const res = await fetch(`/api/venue-directories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) { toast.error("Update failed"); return null }
    return res.json()
  }

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this source?")) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/venue-directories/${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Deleted")
      fetchRows()
    } catch {
      toast.error("Delete failed")
    } finally {
      setDeleting(null)
    }
  }

  const handleBulkActivate = async (isActive: boolean) => {
    if (selectedIds.size === 0) return
    setSaving(true)
    try {
      const res = await fetch("/api/venue-directories/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), isActive }),
      })
      if (!res.ok) throw new Error()
      toast.success(`${selectedIds.size} sources ${isActive ? "activated" : "deactivated"}`)
      setSelectedIds(new Set())
      fetchRows()
    } catch {
      toast.error("Bulk update failed")
    } finally {
      setSaving(false)
    }
  }

  const handleBulkUrlUpdate = async () => {
    if (!bulkText.trim()) { toast.error("Enter at least one URL"); return }
    const urls = bulkText.split("\n").map((u) => u.trim()).filter(Boolean)
    if (urls.length === 0) { toast.error("No valid URLs"); return }
    const ids = Array.from(selectedIds)
    if (urls.length !== ids.length) {
      toast.error(`Mismatch: ${ids.length} sources selected but ${urls.length} URLs provided`)
      return
    }
    setSaving(true)
    try {
      await Promise.all(
        ids.map((id, i) =>
          fetch(`/api/venue-directories/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourceUrl: urls[i] }),
          })
        )
      )
      toast.success(`${ids.length} URLs updated`)
      setBulkOpen(false)
      setBulkText("")
      setSelectedIds(new Set())
      fetchRows()
    } catch {
      toast.error("Bulk update failed")
    } finally {
      setSaving(false)
    }
  }

  const handleApproveSuggestion = async (row: VenueSourceRow) => {
    if (!row.suggestedUrl) return
    const res = await fetch(`/api/venue-directories/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceUrl: row.suggestedUrl,
        originalSourceUrl: row.sourceUrl,
        healthStatus: "valid",
        suggestedUrl: null,
        discoveryMethod: null,
        discoveryConfidence: null,
      }),
    })
    if (!res.ok) { toast.error("Failed"); return }
    toast.success("Suggestion approved")
    fetchRows()
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search venue or URL..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex gap-1 flex-wrap">
          {HEALTH_FILTERS.map((f) => (
            <Button
              key={f.value}
              variant={healthFilter === f.value ? "primary" : "outline"}
              size="sm"
              onClick={() => setHealthFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <Label className="text-xs text-muted-foreground cursor-pointer" onClick={() => setShowInactive((v) => !v)}>
            <Switch checked={showInactive} size="sm" className="mr-1" onCheckedChange={(v) => setShowInactive(v)} />
            Show inactive
          </Label>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border rounded-md bg-muted text-sm">
          <span className="font-medium">{selectedIds.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" /> Update URLs
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleBulkActivate(true)} disabled={saving}>
            <CheckCircle className="h-3.5 w-3.5 mr-1" /> Activate
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleBulkActivate(false)} disabled={saving}>
            <XCircle className="h-3.5 w-3.5 mr-1" /> Deactivate
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: header.column.getSize() !== 150 ? header.column.getSize() : undefined }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><div className="h-4 w-4 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-24 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-48 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-muted rounded animate-pulse" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-muted rounded animate-pulse" /></TableCell>
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-12 text-muted-foreground">
                  No venue directories found
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setEditRow(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-muted-foreground">
        {loading ? "Loading..." : `${filtered.length} sources`}
        {selectedIds.size > 0 && ` · ${selectedIds.size} selected`}
      </p>

      {/* Edit dialog */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow?.venue.name}</DialogTitle>
            <DialogDescription>
              Edit source URL and settings for this venue directory.
            </DialogDescription>
          </DialogHeader>

          {editRow && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Source URL</Label>
                <Input
                  value={editRow.sourceUrl}
                  onChange={(e) => setEditRow((prev) => prev ? { ...prev, sourceUrl: e.target.value } : null)}
                  placeholder="https://..."
                />
                {editRow.suggestedUrl && (
                  <div className="flex items-start gap-2 p-2 border rounded-md bg-amber-50 border-amber-200">
                    <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-amber-800">Suggested URL</p>
                      <p className="text-xs text-amber-700 break-all">{editRow.suggestedUrl}</p>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-6 text-xs"
                        onClick={() => handleApproveSuggestion(editRow)}
                      >
                        Approve suggestion
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Health Status</Label>
                  <Select
                    value={editRow.healthStatus}
                    onValueChange={(v) => setEditRow((prev) => prev ? { ...prev, healthStatus: v as HealthStatus } : null)}
                  >
                    <SelectTrigger>
                      <span className={cn("text-xs")}>{HEALTH_CONFIG[editRow.healthStatus as HealthStatus].label}</span>
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.entries(HEALTH_CONFIG) as [HealthStatus, typeof HEALTH_CONFIG[HealthStatus]][]).map(([k, cfg]) => (
                        <SelectItem key={k} value={k}>{cfg.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Strategy</Label>
                  <Select
                    value={editRow.strategy}
                    onValueChange={(v) => setEditRow((prev) => prev ? { ...prev, strategy: v as FetchStrategy } : null)}
                  >
                    <SelectTrigger>
                      <span className="text-xs">{editRow.strategy}</span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="jina_markdown">Jina Markdown</SelectItem>
                      <SelectItem value="puppeteer_html">Puppeteer HTML</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Batch Size</Label>
                  <Input
                    type="number"
                    value={editRow.batchSize}
                    onChange={(e) => setEditRow((prev) => prev ? { ...prev, batchSize: parseInt(e.target.value) || 5 } : null)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Batch Delay (ms)</Label>
                  <Input
                    type="number"
                    value={editRow.batchDelayMs}
                    onChange={(e) => setEditRow((prev) => prev ? { ...prev, batchDelayMs: parseInt(e.target.value) || 10000 } : null)}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Include this source in scrape runs</p>
                </div>
                <Switch
                  checked={editRow.isActive}
                  onCheckedChange={(v) => setEditRow((prev) => prev ? { ...prev, isActive: v } : null)}
                />
              </div>

              <div className="flex items-center justify-between pt-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => { handleDelete(editRow.id); setEditRow(null) }}
                  disabled={deleting === editRow.id}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {deleting === editRow.id ? "Deleting..." : "Delete"}
                </Button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditRow(null)}>Cancel</Button>
                  <Button
                    onClick={async () => {
                      const res = await fetch(`/api/venue-directories/${editRow.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          sourceUrl: editRow.sourceUrl,
                          healthStatus: editRow.healthStatus,
                          strategy: editRow.strategy,
                          isActive: editRow.isActive,
                          batchSize: editRow.batchSize,
                          batchDelayMs: editRow.batchDelayMs,
                        }),
                      })
                      if (!res.ok) { toast.error("Save failed"); return }
                      toast.success("Saved")
                      setEditRow(null)
                      fetchRows()
                    }}
                    disabled={saving}
                  >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Bulk URL update dialog */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Bulk Update URLs</DialogTitle>
            <DialogDescription>
              Paste URLs to replace the selected sources — one per line, in order.
              {selectedIds.size} sources selected.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New URLs (one per line)</Label>
            <Textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder="https://venue1.com/events&#10;https://venue2.com/calendar&#10;..."
              rows={Math.max(6, selectedIds.size)}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              {bulkText.split("\n").filter(Boolean).length} URLs entered · {selectedIds.size} selected
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setBulkOpen(false); setBulkText("") }}>
              Cancel
            </Button>
            <Button onClick={handleBulkUrlUpdate} disabled={saving || !bulkText.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Update {selectedIds.size} URLs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
