"use client"

import React, { useState } from "react"
import { Button } from "@/components/ui/button"
import { Play } from "lucide-react"
import { toast } from "sonner"

export function RunNowButton({ onComplete }: { onComplete?: () => void }) {
  const [running, setRunning] = useState(false)

  const handleRun = async () => {
    setRunning(true)
    toast.info("Ingestion job started...")

    try {
      const res = await fetch("/api/ingest/run?trigger=manual", {
        method: "POST",
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error ?? "Ingestion failed")
        return
      }

      toast.success(
        `Ingestion complete — ${data.recordsNew} new events found (${data.recordsFound} total scanned)`
      )
      onComplete?.()
    } catch {
      toast.error("Ingestion request failed")
    } finally {
      setRunning(false)
    }
  }

  return (
    <Button
      onClick={handleRun}
      disabled={running}
      loading={running}
      leftIcon={Play}
    >
      {running ? "Running..." : "Run Now"}
    </Button>
  )
}
