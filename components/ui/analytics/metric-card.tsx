// components/analytics/metric-card.tsx

"use client";

import { TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MetricCardDef } from "@/types/components";

const ACCENT_CLASSES: Record<NonNullable<MetricCardDef["accent"]>, string> = {
  primary: "border-l-primary",
  success: "border-l-emerald-500",
  warning: "border-l-amber-500",
  danger: "border-l-destructive",
  info: "border-l-sky-500",
};

const TREND_CONFIG = {
  positive: {
    icon: TrendingUp,
    className: "text-emerald-600 dark:text-emerald-400",
  },
  negative: {
    icon: TrendingDown,
    className: "text-destructive",
  },
  neutral: {
    icon: Minus,
    className: "text-muted-foreground",
  },
};

export function MetricCard({
  label,
  value,
  displayValue,
  trend,
  trendDirection = "neutral",
  comparisonLabel,
  icon: Icon,
  accent = "primary",
  onDrillDown,
}: MetricCardDef) {
  const TrendIcon = TREND_CONFIG[trendDirection].icon;
  const trendClass = TREND_CONFIG[trendDirection].className;
  const isClickable = !!onDrillDown;

  return (
    <div
      onClick={onDrillDown}
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => e.key === "Enter" && onDrillDown?.()
          : undefined
      }
      className={cn(
        "group relative flex flex-col gap-3 rounded-lg border border-border bg-card p-5",
        "border-l-4",
        ACCENT_CLASSES[accent],
        isClickable &&
          "cursor-pointer transition-shadow hover:shadow-sm hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {isClickable && (
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      </div>

      {/* Value */}
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
          {displayValue ?? value}
        </span>

        {(trend || comparisonLabel) && (
          <div className="flex items-center gap-1.5">
            {trend && (
              <span className={cn("flex items-center gap-0.5 text-xs font-medium", trendClass)}>
                <TrendIcon className="h-3 w-3" />
                {trend}
              </span>
            )}
            {comparisonLabel && (
              <span className="text-xs text-muted-foreground">
                {comparisonLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}