"use client"

import { useState, useEffect } from "react"
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, Search } from "lucide-react"
import { toast } from "sonner"

interface WebSearchResult {
  id: string
  queryId: string
  source: string
  title: string
  url: string
  snippet: string | null
  publishedDate: string | null
  page: number
  createdAt: string
}

interface WebSearchQuery {
  id: string
  query: string
  createdAt: string
  results: WebSearchResult[]
}

export default function WebSearchPage() {
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<WebSearchQuery[]>([])
  const [selectedQuery, setSelectedQuery] = useState<WebSearchQuery | null>(null)

  useEffect(() => {
    fetchHistory()
  }, [])

  const fetchHistory = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/web-search?limit=20", { cache: "no-store" })
      const data = await res.json()
      setHistory(data.queries || [])
      if (data.queries && data.queries.length > 0) {
        setSelectedQuery(data.queries[0])
      }
    } catch (error) {
      console.error("Failed to fetch history:", error)
      toast.error("Failed to fetch search history")
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
  }

  const columns: ColumnDef<WebSearchResult>[] = [
    {
      accessorKey: "source",
      header: "Source",
      cell: ({ row }) => (
        <Badge variant="outline">{row.getValue("source")}</Badge>
      ),
    },
    {
      accessorKey: "title",
      header: "Title",
      cell: ({ row }) => (
        <div className="max-w-md">
          <a
            href={row.getValue("url")}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:underline flex items-center gap-1"
          >
            {row.getValue("title")}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ),
    },
    {
      accessorKey: "snippet",
      header: "Snippet",
      cell: ({ row }) => (
        <div className="max-w-md text-sm text-muted-foreground line-clamp-2">
          {row.getValue("snippet") || "—"}
        </div>
      ),
    },
    {
      accessorKey: "publishedDate",
      header: "Published",
      cell: ({ row }) => {
        const date = row.getValue("publishedDate")
        return <span className="text-sm">{date ? formatDate(date as string) : "—"}</span>
      },
    },
    {
      accessorKey: "url",
      header: "URL",
      cell: ({ row }) => (
        <a
          href={row.getValue("url")}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-muted-foreground hover:underline max-w-xs truncate block"
        >
          {row.getValue("url")}
        </a>
      ),
    },
  ]

  const table = useReactTable({
    data: selectedQuery?.results || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <div className="space-y-6">
      {/* History Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <Search className="h-4 w-4" />
            <span>Search History</span>
          </div>
          <div className="space-y-1">
            {loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
            ) : history.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No searches yet</div>
            ) : (
              history.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setSelectedQuery(q)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    selectedQuery?.id === q.id
                      ? "bg-accent text-foreground"
                      : "hover:bg-muted/50 text-muted-foreground"
                  }`}
                >
                  <div className="truncate font-medium">{q.query}</div>
                  <div className="text-xs opacity-70">{formatDate(q.createdAt)}</div>
                  <div className="text-xs opacity-70">{q.results.length} results</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Results Table */}
        <div className="lg:col-span-3">
          {selectedQuery ? (
            <>
              <div className="mb-4">
                <h2 className="text-lg font-semibold">{selectedQuery.query}</h2>
                <p className="text-sm text-muted-foreground">
                  {selectedQuery.results.length} results • {formatDate(selectedQuery.createdAt)}
                </p>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead key={header.id}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow key={row.id}>
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={columns.length} className="h-24 text-center">
                          No results found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select a search from history to view results</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
