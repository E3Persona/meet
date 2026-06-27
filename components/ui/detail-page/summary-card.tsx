import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../card";
import { cn } from "@/lib/utils";
import { SummaryMetric } from "@/types/components";

interface SummaryCardProps {
  metrics?: SummaryMetric[];
  children?: ReactNode;
  className?: string;
}

export function SummaryCard({ metrics = [], children, className }: SummaryCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="p-6">
        {metrics.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {metrics.map((metric, index) => (
              <MetricCard key={index} {...metric} />
            ))}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

function MetricCard({ label, value, icon, trend }: SummaryMetric) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {icon && (
          <div className="shrink-0 text-muted-foreground">
            {icon}
          </div>
        )}
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
      </div>
      
      <div className="flex items-baseline gap-2">
        <div className="text-2xl font-semibold text-foreground">{value}</div>
        
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs font-medium",
              trend.direction === "up" && "text-green-600",
              trend.direction === "down" && "text-red-600",
              trend.direction === "neutral" && "text-muted-foreground"
            )}
          >
            <span>{trend.value}</span>
          </div>
        )}
      </div>
    </div>
  );
}
