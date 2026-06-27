"use client"

import { cn } from "@/lib/utils"

export interface NavItemProps {
  /** Already translated label text */
  label: string
  /** Lucide icon component */
  icon: React.ComponentType<{ className?: string }>
  /** Whether this item is currently active */
  active?: boolean
  /** Override active background style (e.g. for sub-navs with primary tint) */
  activeVariant?: "default" | "primary"
  /** When true, only icon is visible; label appears on hover as tooltip */
  collapsed?: boolean
  className?: string
}

export function NavItem({
  label,
  icon: Icon,
  active = false,
  activeVariant = "default",
  collapsed = false,
  className,
}: NavItemProps) {
  return (
    <span
      className={cn(
        "group/nav relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active && activeVariant === "primary"
          ? "bg-primary/10 text-primary"
          : active
            ? "bg-accent text-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-foreground",
        collapsed && "justify-center px-0",
        className
      )}
    >
      <Icon
        className={cn(
          "h-6 w-6 shrink-0",
          active && activeVariant === "primary" && "text-primary"
        )}
      />
      {!collapsed && <span className="truncate">{label}</span>}

      {collapsed && (
        <span className="pointer-events-none absolute left-full z-50 ml-2 rounded-md bg-popover px-2.5 py-1.5 text-sm font-medium whitespace-nowrap text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/nav:opacity-100">
          {label}
        </span>
      )}
    </span>
  )
}
