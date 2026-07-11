"use client"

import React, { useEffect, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"
import { Loader2 } from "lucide-react"

interface ProgressDialogProps {
  open: boolean
  title: string
  runId: string | null
  onComplete: () => void
}

export function ProgressDialog({ open, title, runId, onComplete }: ProgressDialogProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [finished, setFinished] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !runId) {
      setLogs([])
      setFinished(false)
      return
    }

    const poll = async () => {
      try {
        const res = await fetch(`/api/ingest/progress/${runId}`)
        const data = await res.json()
        setLogs(data.logs ?? [])
        if (data.finished) {
          setFinished(true)
          clearInterval(interval)
          clearTimeout(timeout)
          onComplete()
          return
        }
        if (!res.ok) {
          setFinished(true)
          clearInterval(interval)
          clearTimeout(timeout)
          onComplete()
          return
        }
      } catch {
        // ignore
      }
    }

    poll()
    const interval = setInterval(poll, 1000)

    // Stop polling after 5 minutes
    const timeout = setTimeout(() => {
      clearInterval(interval)
      setFinished(true)
      onComplete()
    }, 300_000)

    return () => {
      clearInterval(interval)
      clearTimeout(timeout)
    }
  }, [open, runId, onComplete])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [logs])

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onComplete() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {!finished && <Loader2 className="h-4 w-4 animate-spin" />}
            {title}
          </DialogTitle>
          <DialogDescription>
            {finished
              ? "Run complete"
              : `${logs.length} log entries — updating live...`}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-80 overflow-y-auto rounded border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
          {logs.length === 0 && !finished && (
            <p className="text-muted-foreground italic">Waiting for progress...</p>
          )}
          {logs.map((msg, i) => (
            <p key={i} className="text-foreground/80">
              {msg}
            </p>
          ))}
          <div ref={bottomRef} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
