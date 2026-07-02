"use client"

import { useState } from "react"
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
} from "lucide-react"

export type SidebarSection =
  | "events"
  | "locations"
  | "templates"
  | "sources"
  | "directories"
  | "schedules"
  | "runs"

const NAV_ITEMS: { id: SidebarSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "events", label: "Events", icon: Calendar },
  { id: "locations", label: "Locations", icon: MapPin },
  { id: "templates", label: "Search Templates", icon: Search },
  { id: "sources", label: "Source Sites", icon: Globe },
  { id: "directories", label: "Directories", icon: FileText },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "runs", label: "Run History", icon: History },
]

interface SidebarProps {
  active: SidebarSection
  onSelect: (section: SidebarSection) => void
  collapsed?: boolean
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
        <div className={cn("flex h-14 items-center border-b px-4", collapsed && "justify-center")}>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight truncate">
              Event Pipeline
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
          <div className="border-t p-3">
            <p className="text-xs text-muted-foreground truncate">
              v0.1.0
            </p>
          </div>
        )}
      </aside>
    </>
  )
}
