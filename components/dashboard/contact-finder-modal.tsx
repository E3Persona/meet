"use client"

import React, { useState, useEffect, useCallback } from "react"
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
import { Loader2, Check, Search, ExternalLink, Star, Trash2, Plus, Pencil } from "lucide-react"
import { toast } from "sonner"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedContact {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
  isPrimary: boolean
  sourceUrl: string | null
  confidence: string
}

interface FoundContact {
  name: string
  title: string | null
  email: string | null
  phone: string | null
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

// ─── Component ────────────────────────────────────────────────────────────────

export function ContactFinderModal({
  eventId,
  eventName,
  open,
  onClose,
  onSaved,
}: ContactFinderModalProps) {
  const [loading, setLoading] = useState(false)
  const [savedContacts, setSavedContacts] = useState<SavedContact[]>([])
  const [foundContacts, setFoundContacts] = useState<FoundContact[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [saving, setSaving] = useState(false)

  // Editable fields
  const [name, setName] = useState("")
  const [title, setTitle] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")

  // ── Load existing contacts ───────────────────────────────────────────────

  const loadSavedContacts = useCallback(async () => {
    try {
      const res = await fetch(`/api/events/${eventId}/contacts`)
      if (res.ok) {
        const data = await res.json()
        setSavedContacts(data.contacts ?? [])
      }
    } catch {
      // Ignore — will show empty state
    }
  }, [eventId])

  useEffect(() => {
    if (open) {
      loadSavedContacts()
      setFoundContacts([])
      setEditingId(null)
      setAddingNew(false)
    }
  }, [open, loadSavedContacts])

  // ── Search for new contacts ──────────────────────────────────────────────

  const handleSearch = async () => {
    setLoading(true)
    setFoundContacts([])
    setEditingId(null)
    setAddingNew(false)

    try {
      const res = await fetch(`/api/events/${eventId}/find-contact`, { method: "POST" })
      const data = await res.json()

      // The API now saves to EventContact and returns the full list
      if (data.contacts) {
        setSavedContacts(data.contacts)
      }
      if (data.newFound > 0) {
        toast.success(`Found ${data.newFound} new contact(s)`)
      } else {
        toast.info("No new contacts found on this page. Try searching manually.")
      }
    } catch {
      toast.error("Failed to search for contacts")
    } finally {
      setLoading(false)
    }
  }

  // ── Start editing a saved contact ────────────────────────────────────────

  const startEdit = (contact: SavedContact) => {
    setEditingId(contact.id)
    setAddingNew(false)
    setName(contact.name)
    setTitle(contact.title ?? "")
    setEmail(contact.email ?? "")
    setPhone(contact.phone ?? "")
  }

  // ── Start adding a new manual contact ────────────────────────────────────

  const startAddNew = () => {
    setAddingNew(true)
    setEditingId(null)
    setName("")
    setTitle("")
    setEmail("")
    setPhone("")
  }

  // ── Save edited contact ──────────────────────────────────────────────────

  const handleSaveEdit = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/events/${eventId}/contacts/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, title: title || null, email: email || null, phone: phone || null }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Contact updated")
      setEditingId(null)
      await loadSavedContacts()
      onSaved()
    } catch {
      toast.error("Failed to update contact")
    } finally {
      setSaving(false)
    }
  }

  // ── Save new manual contact ──────────────────────────────────────────────

  const handleSaveNew = async () => {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/events/${eventId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, title: title || null, email: email || null, phone: phone || null }),
      })
      if (!res.ok) throw new Error("Failed")
      toast.success("Contact added")
      setAddingNew(false)
      await loadSavedContacts()
      onSaved()
    } catch {
      toast.error("Failed to add contact")
    } finally {
      setSaving(false)
    }
  }

  // ── Mark as primary ──────────────────────────────────────────────────────

  const handleSetPrimary = async (contactId: string) => {
    try {
      await fetch(`/api/events/${eventId}/contacts/${contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPrimary: true }),
      })
      await loadSavedContacts()
      onSaved()
    } catch {
      toast.error("Failed to update")
    }
  }

  // ── Delete a contact ─────────────────────────────────────────────────────

  const handleDelete = async (contactId: string) => {
    if (!confirm("Delete this contact?")) return
    try {
      await fetch(`/api/events/${eventId}/contacts/${contactId}`, { method: "DELETE" })
      toast.success("Contact deleted")
      await loadSavedContacts()
      onSaved()
    } catch {
      toast.error("Failed to delete")
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const confidenceBadge = (c: string) => {
    if (c === "high") return <Badge variant="success" size="sm">High</Badge>
    if (c === "medium") return <Badge variant="warning" size="sm">Medium</Badge>
    return <Badge variant="neutral" size="sm">Low</Badge>
  }

  const isEditing = editingId !== null || addingNew

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Contacts</DialogTitle>
          <DialogDescription>
            Contact info for: <strong>{eventName}</strong>
          </DialogDescription>
        </DialogHeader>

        {/* Saved contacts list */}
        {savedContacts.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Saved Contacts ({savedContacts.length})
              </p>
            </div>
            {savedContacts.map((contact) => (
              <div
                key={contact.id}
                className={`p-3 rounded-lg border transition-colors ${
                  editingId === contact.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50"
                }`}
              >
                {editingId === contact.id ? (
                  /* Edit mode */
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={`edit-name-${contact.id}`} className="text-xs">Name</Label>
                        <Input id={`edit-name-${contact.id}`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" />
                      </div>
                      <div>
                        <Label htmlFor={`edit-title-${contact.id}`} className="text-xs">Title</Label>
                        <Input id={`edit-title-${contact.id}`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Event Manager" />
                      </div>
                      <div>
                        <Label htmlFor={`edit-email-${contact.id}`} className="text-xs">Email</Label>
                        <Input id={`edit-email-${contact.id}`} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" />
                      </div>
                      <div>
                        <Label htmlFor={`edit-phone-${contact.id}`} className="text-xs">Phone</Label>
                        <Input id={`edit-phone-${contact.id}`} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="123-456-7891" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleSaveEdit} disabled={saving} leftIcon={Check}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Display mode */
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{contact.name}</p>
                        {contact.isPrimary && (
                          <Badge variant="info" size="sm">Primary</Badge>
                        )}
                        {confidenceBadge(contact.confidence)}
                      </div>
                      {contact.title && (
                        <p className="text-xs text-muted-foreground mt-0.5">{contact.title}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {contact.email ?? "No email"}
                        {contact.phone && ` · ${contact.phone}`}
                      </p>
                      {contact.sourceUrl && (
                        <a
                          href={contact.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground hover:underline inline-flex items-center gap-1 mt-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Source
                        </a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!contact.isPrimary && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSetPrimary(contact.id)}
                          title="Mark as primary"
                        >
                          <Star className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => startEdit(contact)}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDelete(contact.id)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Add new manual contact form */}
        {addingNew && (
          <div className="space-y-3">
            <Separator />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Add Contact Manually
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="new-name" className="text-xs">Name *</Label>
                <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Contact name" autoFocus />
              </div>
              <div>
                <Label htmlFor="new-title" className="text-xs">Title</Label>
                <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Event Manager" />
              </div>
              <div>
                <Label htmlFor="new-email" className="text-xs">Email</Label>
                <Input id="new-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@domain.com" />
              </div>
              <div>
                <Label htmlFor="new-phone" className="text-xs">Phone</Label>
                <Input id="new-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="123-456-7891" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSaveNew} disabled={saving} leftIcon={Check}>
                Save Contact
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddingNew(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Search button + loading */}
        {savedContacts.length === 0 && !loading && !isEditing && (
          <div className="space-y-3">
            <Button onClick={handleSearch} className="w-full" leftIcon={Search}>
              Search for Contacts
            </Button>
            <Button variant="outline" onClick={startAddNew} className="w-full" leftIcon={Plus}>
              Add Manually
            </Button>
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Searching event pages, registration sites, and staff directories...
            </p>
          </div>
        )}

        <DialogFooter>
          {!isEditing && (
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={handleSearch} disabled={loading} leftIcon={Search} className="flex-1">
                Search Again
              </Button>
              <Button variant="outline" onClick={startAddNew} leftIcon={Plus} className="flex-1">
                Add Manually
              </Button>
              <Button variant="outline" onClick={onClose} className="flex-1">
                Close
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
