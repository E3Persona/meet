// ─── Priority Styling Map ─────────────────────────────────────────────────────

import { RowPriority } from "@/types/components"

export const PRIORITY_CLASS_MAP: Record<RowPriority, string> = {
  low: "border-l-4 border-blue-400",
  medium: "border-l-4 border-yellow-400",
  high: "border-l-4 border-red-500",
}

export const PRIORITY_BADGE_CLASS_MAP: Record<RowPriority, string> = {
  low: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  medium:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
}

// ─── Skeleton Row Count ───────────────────────────────────────────────────────

export const SKELETON_ROW_COUNT = 5
export const SKELETON_CARD_COUNT = 3

// ─── Infinite Scroll Threshold (px from bottom) ───────────────────────────────

export const INFINITE_SCROLL_THRESHOLD = 200
