// lib/page-shell/types.ts

export type PageStatus = "loading" | "success" | "empty" | "error" | "refreshing";

export interface PageShellState<T = unknown> {
  status: PageStatus;
  data: T | null;
  error: PageShellError | null;
  lastFetchedAt: Date | null;
}

export interface PageShellError {
  code?: string | number;
  message: string;
  detail?: string;
  retryable?: boolean;
}

export interface PageShellConfig {
  /** Title shown in error/empty states */
  title?: string;
  /** Empty state message */
  emptyMessage?: string;
  /** Empty state description */
  emptyDescription?: string;
  /** Icon for empty state — pass a Lucide icon component */
  emptyIcon?: React.ComponentType<{ className?: string }>;
  /** Primary CTA in empty state */
  emptyAction?: { label: string; onClick: () => void };
  /** Number of skeleton rows/cards to render */
  skeletonCount?: number;
  /** Layout of skeleton: 'list' | 'card' | 'detail' | 'table' | 'dashboard' */
  skeletonLayout?: "list" | "card" | "detail" | "table" | "dashboard";
  /** Disable pull-to-refresh on mobile */
  disablePullToRefresh?: boolean;
}