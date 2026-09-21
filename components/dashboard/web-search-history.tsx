import { prisma } from "@/lib/prisma"
import { RunSearchBar } from "./run-search-bar"

export const dynamic = "force-dynamic"

export default async function SearchTemplatesPage() {
  const results = await prisma.webSearchResult.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      queryId: true,
      source: true,
      title: true,
      url: true,
      snippet: true,
      publishedDate: true,
      page: true,
      query: { select: { query: true, createdAt: true } },
    },
  })

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Search Results</h1>
        <RunSearchBar />
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs tracking-wide text-muted-foreground uppercase">
              <th className="px-4 py-2 font-medium">Result</th>
              <th className="px-4 py-2 font-medium">Query</th>
              <th className="px-4 py-2 font-medium">Source</th>
              <th className="px-4 py-2 font-medium">SERP Page</th>
              <th className="px-4 py-2 font-medium">Event Date</th>
              <th className="px-4 py-2 font-medium">Searched</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-muted-foreground"
                >
                  No results yet — run a search above.
                </td>
              </tr>
            ) : (
              results.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-border last:border-0 hover:bg-accent/50"
                >
                  <td className="max-w-md px-4 py-2">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium hover:underline"
                    >
                      {r.title}
                    </a>
                    {r.snippet && (
                      <p className="truncate text-xs text-muted-foreground">
                        {r.snippet}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.query.query}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.source}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.page}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {r.publishedDate
                      ? new Date(r.publishedDate).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(r.query.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
