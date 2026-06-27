// lib/analytics/types.ts

export type TimeRange = "today" | "7d" | "30d" | "custom";

export interface DateRange {
  from: Date;
  to: Date;
}

export interface AnalyticsFilter {
  timeRange: TimeRange;
  customRange?: DateRange;
  segments?: Record<string, string>; // e.g. { team: "north", agent: "jane" }
}

// ─── Metric Cards ──────────────────────────────────────────────
export interface MetricCardDef {
  id: string;
  label: string;
  value: number | string;
  /** Formatted display value if different from raw */
  displayValue?: string;
  /** e.g. "+12%" or "-3.4%" */
  trend?: string;
  /** positive | negative | neutral — drives color */
  trendDirection?: "positive" | "negative" | "neutral";
  /** Short label for comparison period e.g. "vs last week" */
  comparisonLabel?: string;
  /** Icon component from lucide-react */
  icon?: React.ComponentType<{ className?: string }>;
  /** Accent color key for left border */
  accent?: "primary" | "success" | "warning" | "danger" | "info";
  /** Called when user clicks the card */
  onDrillDown?: () => void;
}

// ─── Charts ────────────────────────────────────────────────────
export type ChartType = "line" | "bar" | "area" | "stacked-bar";

export interface ChartSeries {
  key: string;
  label: string;
  color?: string;
}

export interface ChartDef {
  id: string;
  type: ChartType;
  title: string;
  description?: string;
  /** Data array — each object has a "name" key + series keys */
  data: Record<string, string | number>[];
  series: ChartSeries[];
  /** X-axis data key */
  xKey?: string;
  onDrillDown?: () => void;
}

// ─── Drill-Down List ───────────────────────────────────────────
export interface DrillDownItem {
  id: string;
  primary: string;
  secondary?: string;
  meta?: string;
  badge?: { label: string; variant: "success" | "warning" | "error" | "neutral" | "info" | "outline" };
  onClick?: () => void;
}

export interface DrillDownListDef {
  title: string;
  description?: string;
  items: DrillDownItem[];
  onViewAll?: () => void;
}

// ─── Insight Panels ────────────────────────────────────────────
export type InsightSeverity = "info" | "warning" | "critical";

export interface InsightPanel {
  id: string;
  severity: InsightSeverity;
  title: string;
  explanation: string;
  affectedMetric?: string;
  suggestedAction?: string;
  onAction?: () => void;
}

// ─── Segment Filter ────────────────────────────────────────────
export interface SegmentFilterDef {
  key: string;
  label: string;
  options: { label: string; value: string }[];
}

// ─── Top-level Analytics Page Config ──────────────────────────
export interface AnalyticsPageConfig {
  title: string;
  description?: string;
  segments?: SegmentFilterDef[];
  showRefresh?: boolean;
}