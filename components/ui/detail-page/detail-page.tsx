"use client";

import { ReactNode } from "react";
import { Separator } from "../separator";
import { Skeleton } from "../skeleton";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "../alert";
import { Card, CardContent } from "../card";
import { DetailHeader } from "./detail-header";
import { SidePanel } from "./side-panel";
import { ActivityTimeline } from "./activity-timeline";
import {
  DetailAction,
  StatusBadge,
  SummaryMetric,
  SidePanelSection,
  ActivityEvent,
  DetailPageWidth,
} from "@/types/components";
import { cn } from "@/lib/utils";
import { SummaryCard } from "./summary-card";

// ─── Width helpers ────────────────────────────────────────────────────────────

const widthPresets: Record<string, string> = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
  full: "max-w-full",
};

function resolveWidthClass(width: DetailPageWidth = "xl"): {
  className?: string;
  style?: React.CSSProperties;
} {
  if (typeof width === "number") {
    return { style: { maxWidth: width } };
  }
  return { className: widthPresets[width] ?? widthPresets.xl };
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DetailPageProps {
  // Header
  title: string;
  subtitle?: string;
  status?: StatusBadge;
  primaryActions?: DetailAction[];
  secondaryActions?: DetailAction[];

  // Summary
  summaryMetrics?: SummaryMetric[];
  summaryChildren?: ReactNode;

  // Main content (left column on desktop)
  children: ReactNode;

  // Side panel (right column on desktop)
  sidePanelSections?: SidePanelSection[];
  hideSidePanel?: boolean;

  // Activity (bottom)
  activityEvents?: ActivityEvent[];
  hideActivity?: boolean;

  // Layout
  /** "sm" | "md" | "lg" | "xl" | "full" | number (px) — default "xl" */
  width?: DetailPageWidth;
  /** Side panel width in px — default 280 */
  sidePanelWidth?: number;

  // States
  isLoading?: boolean;
  error?: string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DetailPage({
  title,
  subtitle,
  status,
  primaryActions,
  secondaryActions,
  summaryMetrics = [],
  summaryChildren,
  children,
  sidePanelSections = [],
  hideSidePanel = false,
  activityEvents = [],
  hideActivity = false,
  width = "xl",
  sidePanelWidth = 280,
  isLoading = false,
  error = null,
}: DetailPageProps) {
  const { className: widthClass, style: widthStyle } = resolveWidthClass(width);
  const showSidePanel = !hideSidePanel && sidePanelSections.length > 0;

  if (isLoading) return <DetailPageSkeleton />;
  if (error) return <DetailPageError message={error} />;

  return (
    <div
      className={cn("mx-auto w-full px-6 py-8 space-y-8", widthClass)}
      style={widthStyle}
    >
      {/* Header */}
      <DetailHeader
        title={title}
        subtitle={subtitle}
        status={status}
        primaryActions={primaryActions}
        secondaryActions={secondaryActions}
      />

      {/* Summary */}
      {(summaryMetrics.length > 0 || summaryChildren) && (
        <SummaryCard metrics={summaryMetrics}>{summaryChildren}</SummaryCard>
      )}

      {/* Body: main + side panel */}
      <div
        className={cn(
          "flex gap-6",
          showSidePanel ? "items-start" : "block"
        )}
      >
        {/* Main content */}
        <div className="min-w-0 flex-1 space-y-6">{children}</div>

        {/* Side panel */}
        {showSidePanel && (
          <div
            className="shrink-0 hidden lg:block"
            style={{ width: sidePanelWidth }}
          >
            <SidePanel sections={sidePanelSections} />
          </div>
        )}
      </div>

      {/* Activity */}
      {!hideActivity && (
        <div className="space-y-3">
          <Separator />
          <h3 className="text-sm font-semibold text-foreground">Activity</h3>
          <ActivityTimeline events={activityEvents} />
        </div>
      )}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
// Loading skeleton
function DetailPageSkeleton() {
  return (
    <div className="mx-auto w-full px-6 py-8 space-y-8">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-20" />
              <Skeleton className="h-9 w-20" />
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
      
      <div className="flex gap-6">
        <div className="flex-1 space-y-6">
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-40 w-full" />
            </CardContent>
          </Card>
        </div>
        <div className="w-72 hidden lg:block">
          <Card>
            <CardContent className="p-6">
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function DetailPageError({ message }: { message: string }) {
  return (
    <div className="mx-auto w-full px-6 py-8">
      <Card>
        <CardContent className="p-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}