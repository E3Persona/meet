// components/page-shell/page-shell.tsx

"use client";
import { cn } from "@/lib/utils";


import { PageSkeleton } from "../page-shell/skeletons";
import { ErrorState } from "../page-shell/error-state";
import { EmptyState } from "../page-shell/empty-state";
import { RefreshBanner } from "../page-shell/refresh-banner";
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh";
import { usePageShell } from "@/hooks/use-page-shell";
import { PageShellConfig } from "@/types/components";


interface PageShellProps<T> {
  /** Async function that returns data */
  fetcher: () => Promise<T>;
  /** Return true when fetched data is considered "empty" */
  isEmpty?: (data: T) => boolean;
  /** Render actual page content */
  children: (data: T, refresh: () => void) => React.ReactNode;
  /** Shell configuration */
  config?: PageShellConfig;
  /** Callback fired when user clicks back in error state */
  onBack?: () => void;
  className?: string;
}

export function PageShell<T>({
  fetcher,
  isEmpty,
  children,
  config = {},
  onBack,
  className,
}: PageShellProps<T>) {
  const {
    skeletonLayout = "list",
    skeletonCount,
    emptyMessage = "No data here yet",
    emptyDescription = "Try adding something to get started.",
    emptyIcon,
    emptyAction,
    disablePullToRefresh = false,
  } = config;

  const { state, refresh, retry } = usePageShell<T>({ fetcher, isEmpty });

  usePullToRefresh({
    onRefresh: refresh,
    disabled: disablePullToRefresh,
  });

  const isRefreshing = state.status === "refreshing";
  const isLoading = state.status === "loading";

  return (
    <div className={cn("relative w-full", className)}>
      {/* Refresh banner — sits at top during refreshing */}
      <RefreshBanner visible={isRefreshing} />

      {/* Loading skeleton */}
      {isLoading && (
        <div className="animate-in fade-in-0 duration-200">
          <PageSkeleton layout={skeletonLayout} count={skeletonCount} />
        </div>
      )}

      {/* Error state */}
      {state.status === "error" && state.error && (
        <div className="animate-in fade-in-0 duration-200">
          <ErrorState error={state.error} onRetry={retry} onBack={onBack} />
        </div>
      )}

      {/* Empty state */}
      {state.status === "empty" && (
        <div className="animate-in fade-in-0 duration-200">
          <EmptyState
            title={emptyMessage}
            description={emptyDescription}
            icon={emptyIcon}
            action={emptyAction}
          />
        </div>
      )}

      {/* Success / Refreshing with data */}
      {(state.status === "success" || isRefreshing) && state.data && (
        <div
          className={cn(
            "animate-in fade-in-0 duration-200",
            isRefreshing && "opacity-60 pointer-events-none transition-opacity"
          )}
        >
          {children(state.data, refresh)}
        </div>
      )}
    </div>
  );
}