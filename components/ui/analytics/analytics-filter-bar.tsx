// components/analytics/analytics-filter-bar.tsx

"use client";

import { useState } from "react";
import { RefreshCw, CalendarRange } from "lucide-react";
import { Button } from "../button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select";
import { cn } from "@/lib/utils";
import type { AnalyticsFilter, AnalyticsPageConfig } from "@/types/components";

const TIME_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
] as const;

interface AnalyticsFilterBarProps {
  config: AnalyticsPageConfig;
  filter: AnalyticsFilter;
  onChange: (filter: AnalyticsFilter) => void;
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function AnalyticsFilterBar({
  config,
  filter,
  onChange,
  onRefresh,
  isRefreshing,
}: AnalyticsFilterBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Title */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {config.title}
        </h1>
        {config.description && (
          <p className="text-sm text-muted-foreground mt-0.5">
            {config.description}
          </p>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Segment filters */}
        {config.segments?.map((seg) => (
          <Select
            key={seg.key}
            value={filter.segments?.[seg.key] ?? "all"}
            onValueChange={(v) =>
              onChange({
                ...filter,
                segments: { ...filter.segments, [seg.key]: v },
              })
            }
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue placeholder={seg.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All {seg.label}</SelectItem>
              {seg.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {/* Time range */}
        <div className="flex rounded-md border border-border overflow-hidden">
          {TIME_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange({ ...filter, timeRange: opt.value })}
              className={cn(
                "px-3 py-1.5 text-xs font-medium transition-colors",
                filter.timeRange === opt.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Refresh */}
        {config.showRefresh && onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw
              className={cn("h-3 w-3", isRefreshing && "animate-spin")}
            />
            Refresh
          </Button>
        )}
      </div>
    </div>
  );
}