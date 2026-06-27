"use client"

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  HeaderGroup,
  Row,
  Cell,
} from "@tanstack/react-table"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../table"
import { Checkbox } from "../checkbox"
import { cn } from "@/lib/utils"


import {
  ListToolbar,
  BulkActionBar,
  SelectAllCheckbox,
  EmptyState,
  TableSkeletonRows,
  CardSkeletonList,
  LoadMoreIndicator,
} from "./components"
import { RowId, UniversalListProps } from "@/types/components"
import { useInfiniteScroll, useRowSelection } from "@/hooks/unversallist"
import { useResponsive } from "@/hooks/use-responsive"
import { PRIORITY_CLASS_MAP } from "@/lib/constants/universallist"

const CARD_APPEARANCE_CLASSES = {
  default: "border border-border rounded-lg shadow-sm",
  flat: "border border-border rounded-lg",
  minimal: "rounded-lg",
} as const

export function UniversalList<TData, TValue>({
  columns,
  data,
  getRowId,
  onSearch,
  searchPlaceholder,
  filters,
  onRowClick,
  onRowContextMenu,
  getRowMeta,
  enableSelection = false,
  selectedRows,
  onSelectionChange,
  bulkActions,
  rowActions,
  viewMode = "table",
  renderCard,
  responsive = false,
  responsiveBreakpoint = "md",
  cardAppearance = "default",
  skeletonRowCount,
  skeletonCardCount,
  onLoadMore,
  hasMore,
  isLoadingMore,
  isLoading = false,
  emptyMessage,
  emptyIcon,
  ariaLabel = "Data list",
}: UniversalListProps<TData, TValue>) {

  const allIds: RowId[] = data.map((row, i) => getRowId(row, i))

  const { selected, handleSelect, handleSelectAll, isAllSelected, isSomeSelected } =
    useRowSelection({
      controlled: selectedRows,
      onSelectionChange,
      allIds,
    })

  useInfiniteScroll({ onLoadMore, hasMore })

  const isMobile = useResponsive(responsiveBreakpoint)
  const shouldSwitchToCard = responsive && viewMode === "table" && isMobile && renderCard
  const actualViewMode = shouldSwitchToCard ? "card" : viewMode

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  const selectedData = data.filter((row, i) => selected.has(getRowId(row, i)))

  const colSpan = columns.length + (enableSelection ? 1 : 0) + (rowActions ? 1 : 0)

  const rowProps = (row: TData) => ({
    onClick: () => onRowClick?.(row),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      onRowContextMenu?.(row)
    },
  })

  const cardClasses = CARD_APPEARANCE_CLASSES[cardAppearance]

  return (
    <div className="space-y-3" role="region" aria-label={ariaLabel}>

      <ListToolbar
        onSearch={onSearch}
        searchPlaceholder={searchPlaceholder}
        filters={filters}
      />

      {enableSelection && (
        <BulkActionBar count={selected.size}>
          {bulkActions?.(selectedData)}
        </BulkActionBar>
      )}

      {/* ── TABLE VIEW ── */}
      {actualViewMode === "table" && (
        <div className="border rounded-md overflow-hidden">
          <Table aria-label={ariaLabel}>
            <TableHeader>
              {table.getHeaderGroups().map((hg: HeaderGroup<TData>) => (
                <TableRow key={hg.id} className="bg-muted/40 hover:bg-muted/40">
                  {enableSelection && (
                    <TableHead className="w-10 h-9 py-0">
                      <SelectAllCheckbox
                        isAllSelected={isAllSelected}
                        isSomeSelected={isSomeSelected}
                        onToggle={handleSelectAll}
                      />
                    </TableHead>
                  )}
                  {hg.headers.map((header) => (
                    <TableHead key={header.id} className="h-9 py-0 text-xs text-muted-foreground font-medium">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                  {rowActions && (
                    <TableHead className="w-20 h-9 py-0 text-xs text-muted-foreground font-medium">
                      Actions
                    </TableHead>
                  )}
                </TableRow>
              ))}
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableSkeletonRows colSpan={colSpan} rowCount={skeletonRowCount} />
              ) : data.length === 0 ? (
                <EmptyState
                  message={emptyMessage}
                  icon={emptyIcon}
                  colSpan={colSpan}
                />
              ) : (
                table.getRowModel().rows.map((row: Row<TData>, i: number) => {
                  const original = row.original
                  const id = getRowId(original, i)
                  const meta = getRowMeta?.(original)
                  const isSelected = selected.has(id)

                  return (
                    <TableRow
                      key={row.id}
                      data-state={isSelected ? "selected" : undefined}
                      className={cn(
                        "cursor-pointer transition-colors hover:bg-muted/50",
                        meta?.priority && PRIORITY_CLASS_MAP[meta.priority]
                      )}
                      {...rowProps(original)}
                    >
                      {enableSelection && (
                        <TableCell
                          className="w-10 py-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={(val) =>
                              handleSelect(id, val === true)
                            }
                            aria-label={`Select row ${id}`}
                          />
                        </TableCell>
                      )}
                      {row.getVisibleCells().map((cell: Cell<TData, TValue>) => (
                        <TableCell key={cell.id} className="py-1.5">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                      {rowActions && (
                        <TableCell className="w-20 py-1.5">
                          <div onClick={(e) => e.stopPropagation()}>
                            {rowActions(original, meta)}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── CARD VIEW ── */}
      {actualViewMode === "card" && (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading ? (
            <CardSkeletonList count={skeletonCardCount} />
          ) : data.length === 0 ? (
            <EmptyState message={emptyMessage} icon={emptyIcon} isCard />
          ) : (
            data.map((row, i) => {
              const id = getRowId(row, i)
              const meta = getRowMeta?.(row)
              const isSelected = selected.has(id)

              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  aria-selected={enableSelection ? isSelected : undefined}
                  className={cn(
                    "relative p-4 cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    cardClasses,
                    isSelected && "ring-2 ring-primary bg-primary/5",
                    meta?.priority && PRIORITY_CLASS_MAP[meta.priority]
                  )}
                  {...rowProps(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onRowClick?.(row)
                    }
                  }}
                >
                  {enableSelection && (
                    <div
                      className="absolute top-3 right-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(val) => handleSelect(id, val === true)}
                        aria-label={`Select card ${id}`}
                      />
                    </div>
                  )}

                  {meta?.priority && (
                    <span
                      className={cn(
                        "absolute top-3 left-3 text-xs font-semibold px-2 py-0.5 rounded-full capitalize",
                        meta.priority === "high" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
                        meta.priority === "medium" && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300",
                        meta.priority === "low" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
                      )}
                    >
                      {meta.priority}
                    </span>
                  )}

                  <div className="pb-12">
                    {renderCard?.(row, meta)}
                  </div>

                  {rowActions && (
                    <div
                      className="absolute bottom-3 left-3 right-3 flex justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {rowActions(row, meta)}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {hasMore && <LoadMoreIndicator isLoadingMore={isLoadingMore} />}
    </div>
  )
}
