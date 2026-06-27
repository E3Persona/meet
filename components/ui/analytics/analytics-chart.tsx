// components/analytics/analytics-chart.tsx

"use client";

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { ArrowRight } from "lucide-react";
import { Button } from "../button";
import { cn } from "@/lib/utils";
import { ChartDef } from "@/types/components";

// Default palette — matches shadcn CSS vars + tasteful additions
const DEFAULT_COLORS = [
  "hsl(var(--primary))",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#6366f1",
  "#ec4899",
];

interface AnalyticsChartProps {
  chart: ChartDef;
  className?: string;
}

function resolveColor(series: ChartDef["series"][number], index: number) {
  return series.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export function AnalyticsChart({ chart, className }: AnalyticsChartProps) {
  const { type, title, description, data, series, xKey = "name", onDrillDown } = chart;

  const sharedProps = {
    data,
    margin: { top: 4, right: 4, left: -16, bottom: 0 },
  };

  const axisProps = {
    tick: { fontSize: 11, fill: "hsl(var(--foreground))" },
    axisLine: false,
    tickLine: false,
  };

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: "6px",
      fontSize: 12,
      color: "hsl(var(--foreground))",
    },
    labelStyle: {
      color: "hsl(var(--foreground))",
    },
  };

  function renderChart() {
    switch (type) {
      case "line":
        return (
          <LineChart {...sharedProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipStyle} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "hsl(var(--foreground))" }} />}
            {series.map((s, i) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={resolveColor(s, i)}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart {...sharedProps}>
            <defs>
              {series.map((s, i) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={resolveColor(s, i)} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={resolveColor(s, i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipStyle} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "hsl(var(--foreground))" }} />}
            {series.map((s, i) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={resolveColor(s, i)}
                strokeWidth={2}
                fill={`url(#grad-${s.key})`}
              />
            ))}
          </AreaChart>
        );

      case "bar":
        return (
          <BarChart {...sharedProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipStyle} />
            {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "hsl(var(--foreground))" }} />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={resolveColor(s, i)}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
              />
            ))}
          </BarChart>
        );

      case "stacked-bar":
        return (
          <BarChart {...sharedProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey={xKey} {...axisProps} />
            <YAxis {...axisProps} />
            <Tooltip {...tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 12, color: "hsl(var(--foreground))" }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={resolveColor(s, i)}
                stackId="stack"
                maxBarSize={40}
              />
            ))}
          </BarChart>
        );

      default:
        return null;
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-5 flex flex-col gap-4",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>
        {onDrillDown && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDrillDown}
            className="h-7 gap-1 text-xs shrink-0 text-muted-foreground hover:text-foreground"
          >
            View detail
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Chart */}
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          {renderChart() as React.ReactElement}
        </ResponsiveContainer>
      </div>
    </div>
  );
}