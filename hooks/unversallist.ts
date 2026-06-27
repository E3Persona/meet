import { INFINITE_SCROLL_THRESHOLD } from "../lib/constants/universallist"
import { RowId } from "@/types/components/universallist"
import { useState, useEffect, useCallback } from "react"

// ─── useRowSelection ──────────────────────────────────────────────────────────

interface UseRowSelectionOptions {
  controlled?: Set<RowId>
  onSelectionChange?: (rows: Set<RowId>) => void
  allIds: RowId[]
}

export function useRowSelection({
  controlled,
  onSelectionChange,
  allIds,
}: UseRowSelectionOptions) {
  const [internal, setInternal] = useState<Set<RowId>>(new Set())
  const selected = controlled ?? internal

  const setSelected = useCallback(
    (next: Set<RowId>) => {
      if (onSelectionChange) {
        onSelectionChange(next)
      } else {
        setInternal(next)
      }
    },
    [onSelectionChange]
  )

  const handleSelect = useCallback(
    (id: RowId, checked: boolean) => {
      const next = new Set(selected)
      checked ? next.add(id) : next.delete(id)
      setSelected(next)
    },
    [selected, setSelected]
  )

  const handleSelectAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(allIds) : new Set())
    },
    [allIds, setSelected]
  )

  const isAllSelected = allIds.length > 0 && selected.size === allIds.length
  const isSomeSelected = selected.size > 0 && !isAllSelected

  return {
    selected,
    handleSelect,
    handleSelectAll,
    isAllSelected,
    isSomeSelected,
  }
}

// ─── useInfiniteScroll ────────────────────────────────────────────────────────

interface UseInfiniteScrollOptions {
  onLoadMore?: () => void
  hasMore?: boolean
}

export function useInfiniteScroll({
  onLoadMore,
  hasMore,
}: UseInfiniteScrollOptions) {
  useEffect(() => {
    if (!onLoadMore) return

    const handleScroll = () => {
      const distanceFromBottom =
        document.body.offsetHeight - (window.innerHeight + window.scrollY)

      if (distanceFromBottom <= INFINITE_SCROLL_THRESHOLD && hasMore) {
        onLoadMore()
      }
    }

    window.addEventListener("scroll", handleScroll, { passive: true })
    return () => window.removeEventListener("scroll", handleScroll)
  }, [onLoadMore, hasMore])
}
