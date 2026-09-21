"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { NavItem } from "@/components/ui/nav-item"
import {
  Calendar,
  MapPin,
  Search,
  Globe,
  FileText,
  History,
  CalendarClock,
  Menu,
  X,
  Bot,
  BarChart3,
  Building2,
  Globe2,
} from "lucide-react"

export type SidebarSection =
  | "events"
  | "locations"
  | "templates"
  | "sources"
  | "directories"
  | "venue-directories"
  | "scrapers"
  | "schedules"
  | "runs"
  | "web-search"

const NAV_ITEMS: {
  id: SidebarSection
  label: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  { id: "events", label: "Events", icon: Calendar },
  { id: "web-search", label: "Web Search", icon: Globe2 },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "templates", label: "Search Templates", icon: Search },
  { id: "sources", label: "Source Sites", icon: Globe },
  { id: "directories", label: "Directories", icon: FileText },
  { id: "venue-directories", label: "Venue Directories", icon: Building2 },
  { id: "scrapers", label: "Scrapers", icon: Bot },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "runs", label: "Run History", icon: History },
]

interface SidebarProps {
  active: SidebarSection
  onSelect: (section: SidebarSection) => void
  collapsed?: boolean
}

function ProviderCredits() {
  const [credits, setCredits] = useState<Record<string, any> | null>(null)

  useEffect(() => {
    fetch("/api/providers/status")
      .then((r) => r.json())
      .then((data) => setCredits(data))
      .catch(() => {})
  }, [])

  if (!credits) return null
  if (credits._devMode) {
    return (
      <p className="text-xs font-medium text-emerald-500">
        DEV MODE — unlimited
      </p>
    )
  }

  const limited = Object.entries(credits).filter(
    ([k, v]: [string, any]) => k !== "_devMode" && v.dailyLimitRequests > 0
  )

  if (limited.length === 0) return null

  const low = limited.filter(
    ([, v]: [string, any]) =>
      v.remainingRequests <= 5 ||
      (v.dailyLimitTokens > 0 && v.remainingTokens <= 1000)
  )

  return (
    <div className="space-y-1">
      {low.length > 0 ? (
        <p className="text-xs font-medium text-amber-500">
          {low.length} provider{low.length > 1 ? "s" : ""} low on credits
        </p>
      ) : null}
      {limited.slice(0, 3).map(([name, v]: [string, any]) => (
        <div key={name} className="flex items-center justify-between text-xs">
          <span className="truncate text-muted-foreground">{name}</span>
          <span
            className={
              v.remainingRequests <= 5
                ? "font-medium text-amber-500"
                : "text-muted-foreground"
            }
          >
            {v.remainingRequests}/{v.dailyLimitRequests}
          </span>
        </div>
      ))}
    </div>
  )
}

export function Sidebar({ active, onSelect, collapsed = false }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setMobileOpen((o) => !o)}
        className="fixed top-4 left-4 z-50 rounded-lg bg-background p-2 shadow-md md:hidden"
        aria-label="Toggle sidebar"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r bg-background transition-transform md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          collapsed && "w-16"
        )}
      >
        {/* Logo / brand */}
        <div
          className={cn(
            "flex h-14 items-center gap-2.5 border-b px-4",
            collapsed && "justify-center"
          )}
        >
          <img
            src="/logo.png"
            alt="e3 Personnel"
            className="h-8 w-auto shrink-0"
          />
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight">
              e3 Event Intelligence
            </span>
          )}
          {collapsed && <FileText className="h-5 w-5 text-muted-foreground" />}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onSelect(item.id)
                setMobileOpen(false)
              }}
              className="w-full"
            >
              <NavItem
                label={item.label}
                icon={item.icon}
                active={active === item.id}
                collapsed={collapsed}
              />
            </button>
          ))}
        </nav>

        {/* Footer */}
        {!collapsed && (
          <div className="space-y-1.5 border-t p-3">
            <ProviderCredits />
            <p className="truncate text-xs text-muted-foreground">v0.1.0</p>
          </div>
        )}
      </aside>
    </>
  )
}
