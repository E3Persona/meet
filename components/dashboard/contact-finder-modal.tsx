"use client"

import React, { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Loader2, Check, Search, ExternalLink } from "lucide-react"
import { toast } from "sonner"

interface ContactResult {
  organizerName: string | null
  organizerTitle: string | null
  organizerEmail: string | null
  organizerPhone: string | null
  confidence: string
  sourceUrl: string
}

interface ContactFinderModalProps {
  eventId: string
  eventName: string
  open: boolean
  onClose: () => void
  onSaved: () => void
}

export function ContactFinderModal({
  eventId,
  eventName,
  open,
  onClose,
  onSaved,
}: ContactFinderModalProps) {
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<ContactResult[]>([])
  const [selected, setSelected] = useState<ContactResult | null>(null)

  // Editable fields for the selected contact
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")

  const handleSearch = async () => {
    setLoading(true)
    setResults([])
    setSelected(null)

    try {
      const res = await fetch(`/api/events/${eventId}/find-contact`, {
        method: "POST",
      })
      const data = await res.json()
      setResults(data.contacts ?? [])

      if (data.contacts?.length === 0) {
        toast.info("No contact found for this event. Try searching manually.")
      }
    } catch {
      toast.error("Failed to search for contacts")
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (contact: ContactResult) => {
    setSelected(contact)
    setName(contact.organizerName ?? "")
    setTitle(contact.organizerTitle ?? "")
    setEmail(contact.organizerEmail ?? "")
    setPhone(contact.organizerPhone ?? "")
  }

  const handleSave = async () => {
    try {
      const res = await fetch(`/api/events/${eventId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizerName: name || null,
          organizerTitle: title || null,
          organizerEmail: email || null,
          organizerPhone: phone || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to save")
      toast.success("Contact saved")
      onSaved()
      onClose()
    } catch {
      toast.error("Failed to save contact")
    }
  }

  const confidenceBadge = (c: string) => {
    if (c === "high") return <Badge variant="success" size="sm">High</Badge>
    if (c === "medium") return <Badge variant="warning" size="sm">Medium</Badge>
    return <Badge variant="neutral" size="sm">Low</Badge>
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Find Contact</DialogTitle>
          <DialogDescription>
            Searching for contact info for: <strong>{eventName}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Search button */}
        {results.length === 0 && !loading && (
          <Button onClick={handleSearch} leftIcon={Search} className="w-full">
            Search for Contact Info
          </Button>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Searching event pages, registration sites, and staff directories...
            </p>
          </div>
        )}

        {/* Results list */}
        {results.length > 0 && !selected && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {results.length} contact(s) found. Select one to review and save:
            </p>
            {results.map((contact, i) => (
              <button
                key={i}
                type="button"
                onClick={() => handleSelect(contact)}
                className="w-full text-left p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{contact.organizerName}</p>
                    <p className="text-xs text-muted-foreground">
                      {contact.organizerTitle ?? "No title"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {contact.organizerEmail ?? "No email"} {contact.organizerPhone ? `• ${contact.organizerPhone}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {confidenceBadge(contact.confidence)}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                </div>
              </button>
            ))}
            <Button variant="outline" onClick={handleSearch} size="sm" className="w-full mt-2">
              Search Again
            </Button>
          </div>
        )}

        {/* Edit + Save form */}
        {selected && (
          <div className="space-y-4">
            <Separator />
            <p className="text-xs text-muted-foreground">
              Review and edit before saving:
            </p>
            <div className="space-y-3">
              <div>
                <Label htmlFor="cf-name" className="text-xs">Name</Label>
                <Input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" />
              </div>
              <div>
                <Label htmlFor="cf-title" className="text-xs">Title</Label>
                <Input id="cf-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Conference Planner" />
              </div>
              <div>
                <Label htmlFor="cf-email" className="text-xs">Email</Label>
                <Input id="cf-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" />
              </div>
              <div>
                <Label htmlFor="cf-phone" className="text-xs">Phone</Label>
                <Input id="cf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="123-456-7891" />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Source: <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">{selected.sourceUrl}</a>
            </div>
          </div>
        )}

        <DialogFooter>
          {selected && (
            <>
              <Button variant="outline" onClick={() => setSelected(null)}>
                Back to Results
              </Button>
              <Button onClick={handleSave} leftIcon={Check}>
                Save Contact
              </Button>
            </>
          )}
          {!selected && !loading && (
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
