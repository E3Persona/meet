"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Play, Loader2 } from "lucide-react"

export function RunSearchBar() {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setStatus(null)
    try {
      const res = await fetch("/api/ingest/search-templates", {
        method: "POST",
      })
      const data = await res.json()
      if (!res.ok) {
        setStatus(`Error: ${data.error || res.status}`)
      } else if (data.mode === "targeted") {
        setStatus(
          `Saved ${data.resultsSaved} results, enriched ${data.eventsEnriched} events`
        )
        router.refresh()
      } else {
        setStatus(`Round-robin run queued`)
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {status && (
        <span className="text-xs text-muted-foreground">{status}</span>
      )}
      <button
        onClick={run}
        disabled={running}
        className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        Run search
      </button>
    </div>
  )
}
