import { ColumnDef } from "@tanstack/react-table"
import React from "react"

// ─── Row Metadata ────────────────────────────────────────────────────────────

export type RowPriority = "low" | "medium" | "high"

export type RowMeta = {
  priority?: RowPriority
  status?: string
  badge?: React.ReactNode
}

// ─── Row ID ──────────────────────────────────────────────────────────────────

/** Prefer string IDs to avoid Set key type mismatches (string "1" !== number 1) */
export type RowId = string

// ─── View Modes (Discriminated Union) ────────────────────────────────────────

type TableViewProps<TData> = {
  viewMode?: "table" | "auto"
  /** Not allowed in table mode */
  renderCard?: never
}

type CardViewProps<TData> = {
  viewMode?: "table" | "card" | "auto"
  /** Required for card mode and responsive */
  renderCard: (row: TData, meta?: RowMeta) => React.ReactNode
}

export type ViewProps<TData> = TableViewProps<TData> | CardViewProps<TData>

// ─── Core Props ───────────────────────────────────────────────────────────────

export interface UniversalListBaseProps<TData, TValue> {
  // Data
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Must return a stable, unique STRING id per row */
  getRowId: (row: TData, index: number) => RowId

  // Search + Filters
  onSearch?: (value: string) => void
  searchPlaceholder?: string
  filters?: React.ReactNode

  // Row Behavior
  onRowClick?: (row: TData) => void
  onRowContextMenu?: (row: TData) => void
  getRowMeta?: (row: TData) => RowMeta

  // Selection
  enableSelection?: boolean
  selectedRows?: Set<RowId>
  onSelectionChange?: (rows: Set<RowId>) => void

  // Bulk Actions
  bulkActions?: (selectedItems: TData[]) => React.ReactNode

  // Row Actions
  rowActions?: (row: TData, meta?: RowMeta) => React.ReactNode

  // Card Appearance: "default" (border+shadow), "flat" (border only), "minimal" (no border/shadow)
  cardAppearance?: "default" | "flat" | "minimal"

  // Skeleton
  /** Number of skeleton rows to show while loading (default: 5) */
  skeletonRowCount?: number
  /** Number of skeleton cards to show while loading (default: 3) */
  skeletonCardCount?: number

  // Responsive Behavior
  responsive?: boolean
  responsiveBreakpoint?: "sm" | "md" | "lg" | "xl"

  // Infinite Loading
  onLoadMore?: () => void
  hasMore?: boolean
  isLoadingMore?: boolean

  // States
  isLoading?: boolean
  emptyMessage?: string
  emptyIcon?: React.ReactNode

  // Accessibility
  ariaLabel?: string
}

export type UniversalListProps<TData, TValue> =
  UniversalListBaseProps<TData, TValue> & ViewProps<TData>