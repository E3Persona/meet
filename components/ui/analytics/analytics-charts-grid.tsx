// components/analytics/analytics-charts-grid.tsx

import { AnalyticsChart } from "./analytics-chart";
import type { ChartDef } from "@/types/components";

interface AnalyticsChartsGridProps {
  charts: ChartDef[];
  columns?: 1 | 2;
}

export function AnalyticsChartsGrid({
  charts,
  columns = 2,
}: AnalyticsChartsGridProps) {
  return (
    <div
      className={
        columns === 2
          ? "grid grid-cols-1 gap-4 md:grid-cols-2"
          : "flex flex-col gap-4"
      }
    >
      {charts.map((chart) => (
        <AnalyticsChart key={chart.id} chart={chart} />
      ))}
    </div>
  );
}