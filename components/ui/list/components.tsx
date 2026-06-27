import React from "react"
import { Input } from "../input"
import { Checkbox } from "../checkbox"
import { Text } from "../text"
import { Skeleton } from "../skeleton"
import { SKELETON_CARD_COUNT, SKELETON_ROW_COUNT } from "@/lib/constants/universallist"
import { cn } from "@/lib/utils"

// ─── Toolbar ──────────────────────────────────────────────────────────────────

interface ToolbarProps {
  onSearch?: (value: string) => void
  searchPlaceholder?: string
  filters?: React.ReactNode
}

export function ListToolbar({ onSearch, searchPlaceholder = "Search...", filters }: ToolbarProps) {
  if (!onSearch && !filters) return null

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {onSearch && (
        <Input
          placeholder={searchPlaceholder}
          onChange={(e) => onSearch(e.target.value)}
          className="w-64"
          aria-label="Search list"
        />
      )}
      {filters}
    </div>
  )
}

// ─── Bulk Action Bar ──────────────────────────────────────────────────────────

interface BulkBarProps {
  count: number
  children?: React.ReactNode
}

export function BulkActionBar({ count, children }: BulkBarProps) {
  if (count === 0) return null

  return (
    <div
      role="region"
      aria-label={`${count} rows selected`}
      className="flex items-center justify-between px-4 py-2 border rounded-md bg-muted text-sm"
    >
     <span><Text variant="body" className="font-medium">{count} selected</Text></span>
      <div className="flex gap-2">{children}</div>
    </div>
  )
}

// ─── Select-All Checkbox ──────────────────────────────────────────────────────

interface SelectAllProps {
  isAllSelected: boolean
  isSomeSelected: boolean
  onToggle: (checked: boolean) => void
}

export function SelectAllCheckbox({ isAllSelected, isSomeSelected, onToggle }: SelectAllProps) {
  return (
    <Checkbox
      checked={isAllSelected ? true : isSomeSelected ? "indeterminate" : false}
      onCheckedChange={(val) => onToggle(val === true)}
      aria-label="Select all rows"
    />
  )
}

// ─── Empty State ──────────────────────────────────────────────────────────────

interface EmptyStateProps {
  message?: string
  icon?: React.ReactNode
  colSpan?: number
  isCard?: boolean
}

export function EmptyState({ message = "No results found", icon, colSpan, isCard }: EmptyStateProps) {
  const content = (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
      {icon && <div className="opacity-40">{icon}</div>}
      <Text variant="body" className="text-sm">
        {message}
      </Text>
    </div>
  )

  if (isCard) return content

  return (
    <tr>
      <td colSpan={colSpan} className="text-center">
        {content}
      </td>
    </tr>
  )
}

// ─── Table Skeleton Rows ──────────────────────────────────────────────────────

interface TableSkeletonProps {
  colSpan: number
  rowCount?: number
}

export function TableSkeletonRows({ colSpan, rowCount }: TableSkeletonProps) {
  const count = rowCount ?? SKELETON_ROW_COUNT

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-border">
          {Array.from({ length: colSpan }).map((_, j) => (
            <td key={j} className="h-12 px-4 py-2">
              <Skeleton
                className={cn(
                  "h-3.5 rounded-md",
                  // Vary widths for visual rhythm
                  j === 0 && "w-1/4",
                  j === 1 && "w-1/3",
                  j === 2 && "w-1/2",
                  j === 3 && "w-2/5",
                  j === 4 && "w-1/6",
                  j === 5 && "w-1/5",
                  j > 5 && "w-1/3"
                )}
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ─── Card Skeleton ────────────────────────────────────────────────────────────

interface CardSkeletonProps {
  count?: number
}

export function CardSkeletonList({ count }: CardSkeletonProps) {
  const itemCount = count ?? SKELETON_CARD_COUNT

  return (
    <>
      {Array.from({ length: itemCount }).map((_, i) => (
        <div
          key={i}
          className="border border-border rounded-lg p-4 space-y-3 animate-pulse"
        >
          {/* Header row */}
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/2 rounded-md" />
              <Skeleton className="h-2.5 w-1/3 rounded-md" />
            </div>
          </div>
          {/* Content lines */}
          <div className="space-y-2 pt-1">
            <Skeleton className="h-2.5 w-full rounded-md" />
            <Skeleton className="h-2.5 w-4/5 rounded-md" />
            <Skeleton className="h-2.5 w-2/3 rounded-md" />
          </div>
          {/* Footer */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/50">
            <Skeleton className="h-6 w-16 rounded-md" />
            <Skeleton className="h-6 w-16 rounded-md" />
          </div>
        </div>
      ))}
    </>
  )
}

// ─── Load More Indicator ──────────────────────────────────────────────────────

export function LoadMoreIndicator({ isLoadingMore }: { isLoadingMore?: boolean }) {
  return (
    <div className="text-center py-4 text-sm text-muted-foreground" aria-live="polite">
      <Text variant="bodyMuted" className="text-sm">
        {isLoadingMore ? "Loading more..." : "Scroll for more"}
      </Text>
    </div>
  )
}

// ─── View Mode Toggle ──────────────────────────────────────────────────────────

interface ViewModeToggleProps {
  viewMode: "table" | "card"
  onViewModeChange: (mode: "table" | "card") => void
  responsive?: boolean
  isMobile?: boolean
}

export function ViewModeToggle({ viewMode, onViewModeChange, responsive, isMobile }: ViewModeToggleProps) {
  if (responsive && isMobile) return null // Hide toggle on mobile when responsive is enabled

  return (
    <div className="flex items-center gap-1 border rounded-md p-1">
      <button
        onClick={() => onViewModeChange("table")}
        className={cn(
          "px-2 py-1 text-sm rounded transition-colors",
          viewMode === "table"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
        aria-label="Table view"
      >
        <Text variant="button">
          Table
        </Text>
      </button>
      <button
        onClick={() => onViewModeChange("card")}
        className={cn(
          "px-2 py-1 text-sm rounded transition-colors",
          viewMode === "card"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
        aria-label="Card view"
      >
        <Text variant="button">
          Cards
        </Text>
      </button>
    </div>
  )
}
