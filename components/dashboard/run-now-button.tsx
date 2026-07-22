"use client"

import React, { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Play, Calendar } from "lucide-react"
import { toast } from "sonner"

interface LocationOption {
  id: string
  name: string
  type: "CITY" | "VENUE"
  city: string | null
  state: string | null
  active: boolean
}

export function RunNowButton({ onComplete }: { onComplete?: () => void }) {
  const [running, setRunning] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [locations, setLocations] = useState<LocationOption[]>([])
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  const fetchLocations = useCallback(async () => {
    try {
      const res = await fetch("/api/locations")
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      setLocations(data)
    } catch {
      // silently fail — locations are optional
    }
  }, [])

  useEffect(() => {
    if (dialogOpen) fetchLocations()
  }, [dialogOpen, fetchLocations])

  const handleRun = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setRunning(true)
    toast.info("Ingestion job started...")

    try {
      const body: Record<string, any> = { scraperTypes: ["search", "cp", "venues"] }
      if (selectedLocationIds.length > 0) body.locationIds = selectedLocationIds
      if (dateFrom) body.dateFrom = dateFrom
      if (dateTo) body.dateTo = dateTo

      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? "Ingestion failed")
        return
      }

      const parts = [`${data.recordsNew} new events found (${data.recordsFound} total scanned)`]
      if (data.manualResults?.checked) {
        parts.push(`${data.manualResults.checked} manual sources checked`)
      }
      toast.success(parts.join(" · "))

      if (data.warnings?.length > 0) {
        const uniqueWarnings = [...new Set(data.warnings)]
        toast.warning(`Provider issues: ${uniqueWarnings.slice(0, 3).join("; ")}${uniqueWarnings.length > 3 ? ` (+${uniqueWarnings.length - 3} more)` : ""}`)
      }
      setDialogOpen(false)
      onComplete?.()
    } catch {
      toast.error("Ingestion request failed")
    } finally {
      setRunning(false)
    }
  }

  const toggleLocation = (id: string) => {
    setSelectedLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const activeCities = locations.filter((l) => l.type === "CITY" && l.active)
  const activeVenues = locations.filter((l) => l.type === "VENUE" && l.active)
  const inactiveLocations = locations.filter((l) => !l.active)

  return (
    <>
      <Button
        onClick={() => setDialogOpen(true)}
        leftIcon={Play}
      >
        Run Now
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run Ingestion</DialogTitle>
            <DialogDescription>
              Optionally target specific locations and a date range.
              Leave empty to run all locations with default date range.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleRun} className="space-y-4">
            {/* Date range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dateFrom">Date From</Label>
                <Input
                  id="dateFrom"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dateTo">Date To</Label>
                <Input
                  id="dateTo"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* Location selector */}
            <div className="space-y-1.5">
              <Label>Locations ({selectedLocationIds.length} selected)</Label>
              <div className="max-h-48 overflow-y-auto border border-border rounded-md p-2 space-y-1 text-sm">
                {activeCities.length === 0 && activeVenues.length === 0 && (
                  <p className="text-muted-foreground text-xs p-2">Loading locations...</p>
                )}
                {activeCities.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-2 py-1">
                    <input
                      type="checkbox"
                      checked={selectedLocationIds.includes(c.id)}
                      onChange={() => toggleLocation(c.id)}
                      className="accent-primary"
                    />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">({c.state})</span>
                  </label>
                ))}
                {activeVenues.map((v) => (
                  <label key={v.id} className="flex items-center gap-2 cursor-pointer hover:bg-muted/30 rounded px-2 py-1 pl-6">
                    <input
                      type="checkbox"
                      checked={selectedLocationIds.includes(v.id)}
                      onChange={() => toggleLocation(v.id)}
                      className="accent-primary"
                    />
                    <span>{v.name}</span>
                    {v.city && <span className="text-xs text-muted-foreground">({v.city}, {v.state})</span>}
                  </label>
                ))}
                {inactiveLocations.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 pt-2 border-t border-border mt-1">
                    {inactiveLocations.length} inactive location{inactiveLocations.length > 1 ? "s" : ""} hidden
                  </p>
                )}
              </div>
              {selectedLocationIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedLocationIds([])}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear selection
                </button>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={running}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                leftIcon={running ? undefined : Play}
                loading={running}
              >
                {running ? "Running..." : "Start Run"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
