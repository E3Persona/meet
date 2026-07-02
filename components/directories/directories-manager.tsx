"use client"

import React, { useState, useCallback, useEffect, startTransition } from "react"
import { UniversalList } from "@/components/ui/list/universallist"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ExternalLink, Play, CheckCircle, XCircle, Loader2, ChevronDown, ChevronUp, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { ColumnDef } from "@tanstack/react-table"

interface SourceSite {
  id: string
  name: string
  url: string | null
  active: boolean
  scrapeMode: string
  lastScrapeStatus: string | null
}

interface SourceSiteConfig {
  id?: string
  sourceSiteId?: string
  paginationType: string | null
  paginationParam: string | null
  paginationStart: number
  maxPages: number
  listingUrlTemplate: string | null
  selectorEventContainer: string | null
  selectorEventName: string | null
  selectorEventDateStart: string | null
  selectorEventDateEnd: string | null
  selectorEventUrl: string | null
  selectorVenue: string | null
  selectorCity: string | null
  followDetailPage: boolean
  firecrawlFallback: boolean
  aiFallback: boolean
  selectorDetailOrganizer: string | null
  selectorDetailEmail: string | null
  selectorDetailPhone: string | null
  lastTestedAt: string | null
  lastTestStatus: string | null
  lastTestNotes: string | null
}

interface SiteWithConfig extends SourceSite {
  sourceSiteConfig: SourceSiteConfig | null
}

interface TestResult {
  siteId: string
  siteName: string
  totalPages: number
  totalContainers: number
  totalEvents: number
  pages: { url: string; pageNum: number; fetchMethod: string; containersFound: number; eventsExtracted: number; aiEvents: number }[]
  preview: { name: string | null; dateStart: string | null; dateEnd: string | null; url: string | null }[]
  errors: string[]
  firecrawlFallbackUsed: boolean
  aiFallbackUsed: boolean
}

const PAGINATION_TYPE_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Query param (?page=N)", value: "query_param" },
  { label: "Path segment (/page/N)", value: "path_segment" },
]

const STATUS_BADGE: Record<string, "success" | "warning" | "error" | "neutral"> = {
  pass: "success",
  partial: "warning",
  fail: "error",
}

function emptyConfig(): SourceSiteConfig {
  return {
    paginationType: "none",
    paginationParam: null,
    paginationStart: 1,
    maxPages: 5,
    listingUrlTemplate: null,
    selectorEventContainer: null,
    selectorEventName: null,
    selectorEventDateStart: null,
    selectorEventDateEnd: null,
    selectorEventUrl: null,
    selectorVenue: null,
    selectorCity: null,
    followDetailPage: false,
    firecrawlFallback: true,
    aiFallback: false,
    selectorDetailOrganizer: null,
    selectorDetailEmail: null,
    selectorDetailPhone: null,
    lastTestedAt: null,
    lastTestStatus: null,
    lastTestNotes: null,
  }
}

export function DirectoriesManager() {
  const [sites, setSites] = useState<SiteWithConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedSite, setSelectedSite] = useState<SiteWithConfig | null>(null)
  const [config, setConfig] = useState<SourceSiteConfig>(emptyConfig())
  const [configOpen, setConfigOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [showTestOutput, setShowTestOutput] = useState(false)
  const [testingAll, setTestingAll] = useState(false)
  const [allTestResults, setAllTestResults] = useState<{ siteName: string; status: string; totalEvents: number; errors: string[] }[] | null>(null)
  const [htmlSnippet, setHtmlSnippet] = useState("")

  const fetchSites = useCallback(async () => {
    try {
      const res = await fetch("/api/source-sites")
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json()
      const enriched = await Promise.all(
        data.map(async (s: SourceSite) => {
          const cres = await fetch(`/api/source-sites/${s.id}/config`)
          const cfg = await cres.json()
          return { ...s, sourceSiteConfig: cfg && cfg.id ? cfg : null }
        })
      )
      setSites(enriched)
    } catch {
      toast.error("Failed to load source sites")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    startTransition(() => { fetchSites() })
  }, [fetchSites])

  const openConfig = (site: SiteWithConfig) => {
    setSelectedSite(site)
    setConfig(site.sourceSiteConfig ? { ...site.sourceSiteConfig } : emptyConfig())
    setTestResult(null)
    setShowTestOutput(false)
    setHtmlSnippet("")
    setConfigOpen(true)
  }

  const updateConfig = (key: string, value: unknown) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }

  const saveConfig = async () => {
    if (!selectedSite) return
    setSaving(true)
    try {
      const res = await fetch(`/api/source-sites/${selectedSite.id}/config`, {
        method: config.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error("Failed to save")
      const saved = await res.json()
      setConfig(saved)
      toast.success("Config saved")
      fetchSites()
    } catch {
      toast.error("Failed to save config")
    } finally {
      setSaving(false)
    }
  }

  const testSite = async () => {
    if (!selectedSite) return
    setTesting(true)
    setTestResult(null)
    setShowTestOutput(true)
    try {
      const res = await fetch(`/api/source-sites/${selectedSite.id}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })
      if (!res.ok) throw new Error("Test failed")
      const result = await res.json()
      setTestResult(result)
    } catch (err) {
      toast.error("Test failed: " + (err instanceof Error ? err.message : String(err)))
    } finally {
      setTesting(false)
    }
  }

  const markTested = async (status: string) => {
    if (!selectedSite) return
    try {
      const notes = prompt("Test notes (optional):")
      await fetch(`/api/source-sites/${selectedSite.id}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lastTestStatus: status,
          lastTestNotes: notes || null,
          lastTestedAt: new Date().toISOString(),
        }),
      })
      toast.success("Test status updated")
      fetchSites()
      setConfig((prev) => ({
        ...prev,
        lastTestStatus: status,
        lastTestNotes: notes,
        lastTestedAt: new Date().toISOString(),
      }))
    } catch {
      toast.error("Failed to update test status")
    }
  }

  const deleteSite = async (site: SiteWithConfig) => {
    if (!confirm(`Delete source site "${site.name}"? This will also remove its config.`)) return
    try {
      await fetch(`/api/source-sites/${site.id}`, { method: "DELETE" })
      toast.success("Source site deleted")
      fetchSites()
    } catch {
      toast.error("Failed to delete source site")
    }
  }

  const testAll = async () => {
    setTestingAll(true)
    setAllTestResults(null)
    try {
      const res = await fetch("/api/source-sites/test-all", { method: "POST" })
      if (!res.ok) throw new Error("Test failed")
      const data = await res.json()
      setAllTestResults(data.results)
      toast.success(`Tested ${data.results.length} sites`)
      fetchSites()
    } catch {
      toast.error("Failed to test all sites")
    } finally {
      setTestingAll(false)
    }
  }

  const configuredSites = sites.filter((s) => s.sourceSiteConfig)
  const unconfiguredSites = sites.filter((s) => !s.sourceSiteConfig)

  const columns: ColumnDef<SiteWithConfig, unknown>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const s = row.original
        return (
          <div>
            <p className="font-medium text-sm">{s.name}</p>
            {s.url && (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-xs text-muted-foreground hover:underline flex items-center gap-1 mt-0.5"
              >
                {s.url}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )
      },
    },
    {
      id: "scrapeMode",
      header: "Type",
      cell: ({ row }) => (
        <Badge variant="info" size="sm">
          {row.original.scrapeMode}
        </Badge>
      ),
    },
    {
      id: "configStatus",
      header: "Config",
      cell: ({ row }) => {
        const has = !!row.original.sourceSiteConfig
        return (
          <Badge variant={has ? "success" : "neutral"} size="sm">
            {has ? "Configured" : "None"}
          </Badge>
        )
      },
    },
    {
      id: "testStatus",
      header: "Test Status",
      cell: ({ row }) => {
        const cfg = row.original.sourceSiteConfig
        if (!cfg?.lastTestStatus) return <span className="text-xs text-muted-foreground">Untested</span>
        return (
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_BADGE[cfg.lastTestStatus] ?? "neutral"} size="sm">
              {cfg.lastTestStatus}
            </Badge>
            {cfg.lastTestedAt && (
              <span className="text-xs text-muted-foreground">
                {new Date(cfg.lastTestedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>{configuredSites.length} configured</span>
          <span>·</span>
          <span>{unconfiguredSites.length} unconfigured</span>
          <span>·</span>
          <span>{sites.length} total</span>
        </div>
        <Button
          onClick={testAll}
          disabled={testingAll || configuredSites.length === 0}
          leftIcon={testingAll ? undefined : Play}
        >
          {testingAll ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Testing...</>
          ) : (
            "Test all configured"
          )}
        </Button>
      </div>

      {allTestResults && (
        <div className="border rounded-lg p-4 space-y-2">
          <p className="text-sm font-medium">Batch test results</p>
          {allTestResults.map((r) => (
            <div key={r.siteName} className="flex items-center justify-between text-sm">
              <span>{r.siteName}</span>
              <div className="flex items-center gap-2">
                {r.status === "pass" ? (
                  <CheckCircle className="h-4 w-4 text-green-500" />
                ) : r.status === "fail" ? (
                  <XCircle className="h-4 w-4 text-red-500" />
                ) : (
                  <span className="text-yellow-500 text-xs">Partial</span>
                )}
                <span className="text-xs text-muted-foreground">{r.totalEvents} events</span>
              </div>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setAllTestResults(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <UniversalList
        columns={columns}
        data={sites}
        getRowId={(row) => row.id}
        isLoading={loading}
        emptyMessage="No source sites yet. Add one in Source Sites first."
        ariaLabel="Directories"
        onRowClick={openConfig}
        searchPlaceholder="Search directories..."
        rowActions={(s) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                deleteSite(s)
              }}
              title="Delete site"
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        )}
      />

      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedSite?.name}</DialogTitle>
            <DialogDescription>
              Configure CSS selectors for deterministic event extraction.
              {selectedSite?.url && (
                <a
                  href={selectedSite.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Open site <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Pagination section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Pagination & URL</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label>Listing URL Template</Label>
                  <Input
                    placeholder="https://site.com/events?city={CITY}&month={MONTH}"
                    value={config.listingUrlTemplate ?? ""}
                    onChange={(e) => updateConfig("listingUrlTemplate", e.target.value || null)}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Use {"{CITY}"}, {"{MONTH}"}, {"{YEAR}"} as placeholders
                  </p>
                </div>
                <div>
                  <Label>Pagination Type</Label>
                  <Select
                    value={config.paginationType ?? "none"}
                    onValueChange={(v) => updateConfig("paginationType", v === "none" ? "none" : v)}
                  >
                    <SelectTrigger placeholder="Select..." />
                    <SelectContent>
                      {PAGINATION_TYPE_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {config.paginationType && config.paginationType !== "none" && (
                  <>
                    <div>
                      <Label>Param Name</Label>
                      <Input
                        placeholder="page"
                        value={config.paginationParam ?? ""}
                        onChange={(e) => updateConfig("paginationParam", e.target.value || null)}
                      />
                    </div>
                    <div>
                      <Label>Start Page</Label>
                      <Input
                        type="number"
                        value={config.paginationStart}
                        onChange={(e) => updateConfig("paginationStart", parseInt(e.target.value) || 1)}
                      />
                    </div>
                    <div>
                      <Label>Max Pages</Label>
                      <Input
                        type="number"
                        value={config.maxPages}
                        onChange={(e) => updateConfig("maxPages", parseInt(e.target.value) || 5)}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>

            <Separator />

            {/* Selectors section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">CSS Selectors</h3>
              <p className="text-xs text-muted-foreground">
                Enter CSS selectors to extract event data from the page. Leave blank if not applicable.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectorField label="Event Container" value={config.selectorEventContainer} placeholder=".event-item, .card, tr.event" onChange={(v) => updateConfig("selectorEventContainer", v)} />
                <SelectorField label="Event Name" value={config.selectorEventName} placeholder=".event-title a, h2 a" onChange={(v) => updateConfig("selectorEventName", v)} />
                <SelectorField label="Date Start" value={config.selectorEventDateStart} placeholder=".date .start, time:first" onChange={(v) => updateConfig("selectorEventDateStart", v)} />
                <SelectorField label="Date End" value={config.selectorEventDateEnd} placeholder=".date .end, time:last" onChange={(v) => updateConfig("selectorEventDateEnd", v)} />
                <SelectorField label="Event URL" value={config.selectorEventUrl} placeholder="a.event-link, h2 a" onChange={(v) => updateConfig("selectorEventUrl", v)} />
                <SelectorField label="Venue" value={config.selectorVenue} placeholder=".venue, .location" onChange={(v) => updateConfig("selectorVenue", v)} />
                <SelectorField label="City" value={config.selectorCity} placeholder=".city, .location-city" onChange={(v) => updateConfig("selectorCity", v)} />
              </div>
            </div>

            <Separator />

            {/* Fallback section */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold">Fallback Methods</h3>
              <p className="text-xs text-muted-foreground">
                When plain fetch fails or selectors return too few events, try these.
              </p>
              <div className="flex items-center gap-2">
                <Switch
                  id="firecrawl-fallback"
                  checked={config.firecrawlFallback}
                  onCheckedChange={(v) => updateConfig("firecrawlFallback", v)}
                  size="sm"
                />
                <Label htmlFor="firecrawl-fallback" className="text-xs">Firecrawl fallback (raw HTML fetch on failure)</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="ai-fallback"
                  checked={config.aiFallback}
                  onCheckedChange={(v) => updateConfig("aiFallback", v)}
                  size="sm"
                />
                <Label htmlFor="ai-fallback" className="text-xs">AI extraction fallback (LLM when selectors find &lt; 2 events)</Label>
              </div>
            </div>

            <Separator />

            {/* Detail page section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Detail Page Scraping</h3>
                <div className="flex items-center gap-2">
                  <Label htmlFor="follow-detail" className="text-xs">Follow detail links</Label>
                  <Switch
                    id="follow-detail"
                    checked={config.followDetailPage}
                    onCheckedChange={(v) => updateConfig("followDetailPage", v)}
                    size="sm"
                  />
                </div>
              </div>
              {config.followDetailPage && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectorField label="Organizer Name" value={config.selectorDetailOrganizer} placeholder=".organizer, .contact-name" onChange={(v) => updateConfig("selectorDetailOrganizer", v)} />
                  <SelectorField label="Email" value={config.selectorDetailEmail} placeholder=".email, a[href^='mailto:']" onChange={(v) => updateConfig("selectorDetailEmail", v)} />
                  <SelectorField label="Phone" value={config.selectorDetailPhone} placeholder=".phone, .tel" onChange={(v) => updateConfig("selectorDetailPhone", v)} />
                </div>
              )}
            </div>

            <Separator />

            {/* HTML Snippet */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">HTML Reference</h3>
              <p className="text-xs text-muted-foreground">
                Paste a snippet of the site&apos;s HTML here for reference when writing selectors. Not parsed automatically.
              </p>
              <Textarea
                placeholder="<div class='event-item'><h2 class='title'>Event Name</h2>..."
                value={htmlSnippet}
                onChange={(e) => setHtmlSnippet(e.target.value)}
                rows={6}
                className="font-mono text-xs"
              />
            </div>

            <Separator />

            {/* Test section */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Button onClick={saveConfig} disabled={saving}>
                  {saving ? "Saving..." : "Save Config"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={testSite}
                  disabled={testing || !config.listingUrlTemplate}
                  leftIcon={testing ? undefined : Play}
                >
                  {testing ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Testing...</>
                  ) : (
                    "Test this site"
                  )}
                </Button>
              </div>

              {showTestOutput && testResult && (
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Test Results</p>
                    <Button variant="ghost" size="sm" onClick={() => setShowTestOutput(!showTestOutput)}>
                      {showTestOutput ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    {testResult.firecrawlFallbackUsed && (
                      <Badge variant="warning" size="sm">Used Firecrawl</Badge>
                    )}
                    {testResult.aiFallbackUsed && (
                      <Badge variant="info" size="sm">Used AI extraction</Badge>
                    )}
                    {!testResult.firecrawlFallbackUsed && !testResult.aiFallbackUsed && (
                      <Badge variant="success" size="sm">Plain fetch + selectors</Badge>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Pages</p>
                      <p className="font-medium">{testResult.totalPages}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Containers</p>
                      <p className="font-medium">{testResult.totalContainers}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Events</p>
                      <p className="font-medium">{testResult.totalEvents}</p>
                    </div>
                  </div>
                  {testResult.pages.length > 0 && (
                    <div className="text-xs text-muted-foreground space-y-1">
                      {testResult.pages.map((p) => (
                        <p key={p.pageNum}>
                          Page {p.pageNum}: {p.containersFound} containers, {p.eventsExtracted} extracted
                          {p.fetchMethod === "firecrawl" && <span className="text-yellow-500"> (Firecrawl)</span>}
                          {p.aiEvents > 0 && <span className="text-blue-500"> (+{p.aiEvents} AI)</span>}
                          <span className="block truncate">{p.url}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  {testResult.errors.length > 0 && (
                    <div className="text-xs text-red-500 space-y-1">
                      {testResult.errors.map((e, i) => (
                        <p key={i}>Error: {e}</p>
                      ))}
                    </div>
                  )}
                  {testResult.preview.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Preview (first 3):</p>
                      {testResult.preview.map((ev, i) => (
                        <div key={i} className="text-xs border-l-2 border-muted pl-2">
                          <p className="font-medium">{ev.name ?? "—"}</p>
                          <p className="text-muted-foreground">
                            {ev.dateStart ?? "?"}{ev.dateEnd ? ` — ${ev.dateEnd}` : ""}
                          </p>
                          {ev.url && (
                            <a href={ev.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                              {ev.url}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Mark as tested */}
            <div className="flex items-center gap-2 pt-2">
              <span className="text-xs text-muted-foreground">Mark as:</span>
              <Button variant="outline" size="sm" onClick={() => markTested("pass")}>
                <CheckCircle className="h-3.5 w-3.5 mr-1 text-green-500" />
                Pass
              </Button>
              <Button variant="outline" size="sm" onClick={() => markTested("partial")}>
                Partial
              </Button>
              <Button variant="outline" size="sm" onClick={() => markTested("fail")}>
                <XCircle className="h-3.5 w-3.5 mr-1 text-red-500" />
                Fail
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SelectorField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string | null
  placeholder: string
  onChange: (v: string | null) => void
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="font-mono text-xs"
      />
    </div>
  )
}
