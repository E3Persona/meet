// lib/page-shell/skeletons.tsx


import { cn } from "@/lib/utils";
import { Skeleton } from "../skeleton";

function SkeletonRow({ widths = ["100%", "60%"] }: { widths?: string[] }) {
  return (
    <div className="flex flex-col gap-2 py-3">
      {widths.map((w, i) => (
        <Skeleton key={i} className="h-4" style={{ width: w }} />
      ))}
    </div>
  );
}

export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-[55%]" />
            <Skeleton className="h-3 w-[35%]" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3"
        >
          <div className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-4 w-[60%]" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-[75%]" />
          <div className="flex items-center justify-between pt-1">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-14 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* Header */}
      <div className="flex gap-4 border-b border-border bg-muted/40 px-4 py-3">
        {[30, 20, 20, 15, 15].map((w, i) => (
          <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-4 px-4 py-3",
            i < count - 1 && "border-b border-border"
          )}
        >
          {[30, 20, 20, 15, 15].map((w, j) => (
            <Skeleton key={j} className="h-4" style={{ width: `${w}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Left / Main */}
      <div className="lg:col-span-2 flex flex-col gap-6">
        <div className="rounded-lg border border-border bg-card p-6 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
          <div className="border-t border-border pt-4 flex flex-col gap-3">
            <SkeletonRow widths={["80%", "55%"]} />
            <SkeletonRow widths={["70%", "45%"]} />
            <SkeletonRow widths={["60%"]} />
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 flex flex-col gap-3">
          <Skeleton className="h-4 w-36 mb-1" />
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonRow key={i} widths={["100%", "65%"]} />
          ))}
        </div>
      </div>
      {/* Right / Sidebar */}
      <div className="flex flex-col gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3"
          >
            <Skeleton className="h-4 w-28" />
            {Array.from({ length: 3 }).map((_, j) => (
              <SkeletonRow key={j} widths={["90%", "60%"]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-2 w-16" />
          </div>
        ))}
      </div>
      {/* Chart area */}
      <div className="rounded-lg border border-border bg-card p-6 flex flex-col gap-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-48 w-full rounded-md" />
      </div>
      {/* Two column */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-5 flex flex-col gap-3"
          >
            <Skeleton className="h-4 w-32" />
            {Array.from({ length: 4 }).map((_, j) => (
              <SkeletonRow key={j} widths={["100%", "50%"]} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const SKELETONS = {
  list: ListSkeleton,
  card: CardSkeleton,
  table: TableSkeleton,
  detail: DetailSkeleton,
  dashboard: DashboardSkeleton,
};

export function PageSkeleton({
  layout = "list",
  count,
}: {
  layout?: keyof typeof SKELETONS;
  count?: number;
}) {
  const Component = SKELETONS[layout];
  return <Component count={count} />;
}