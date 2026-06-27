"use client"

import React, { useState, useEffect } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

interface Run {
  id: string
  startedAt: string
  finishedAt: string | null
  trigger: string
  status: string
  recordsFound: number
  recordsNew: number
  errorMessage: string | null
}

const STATUS_BADGE = {
  running: { variant: "info" as const, label: "Running" },
  success: { variant: "success" as const, label: "Success" },
  failed: { variant: "error" as const, label: "Failed" },
}

export function RunHistoryTable() {
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch("/api/runs")
      .then((r) => r.json())
      .then(setRuns)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const fmt = (d: string) =>
    new Date(d).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 text-xs">Started</TableHead>
              <TableHead className="h-9 text-xs">Finished</TableHead>
              <TableHead className="h-9 text-xs">Trigger</TableHead>
              <TableHead className="h-9 text-xs">Status</TableHead>
              <TableHead className="h-9 text-xs text-right">Found</TableHead>
              <TableHead className="h-9 text-xs text-right">New</TableHead>
              <TableHead className="h-9 text-xs">Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j} className="h-10">
                      <div className="h-3 bg-muted rounded animate-pulse w-3/4" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : runs.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-16 text-center text-muted-foreground"
                >
                  No runs yet. Click "Run Now" to start the first ingestion.
                </TableCell>
              </TableRow>
            ) : (
              runs.map((run) => {
                const statusConfig =
                  STATUS_BADGE[run.status as keyof typeof STATUS_BADGE] ??
                  STATUS_BADGE.running
                return (
                  <TableRow key={run.id}>
                    <TableCell className="text-sm">{fmt(run.startedAt)}</TableCell>
                    <TableCell className="text-sm">
                      {run.finishedAt ? fmt(run.finishedAt) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" size="sm">
                        {run.trigger}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusConfig.variant} size="sm">
                        {statusConfig.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {run.recordsFound}
                    </TableCell>
                    <TableCell className="text-sm text-right tabular-nums">
                      {run.recordsNew}
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate">
                      {run.errorMessage ?? "—"}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
