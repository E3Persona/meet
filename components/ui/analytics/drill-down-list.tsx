// components/analytics/drill-down-list.tsx

"use client";

import { ArrowRight, ChevronRight } from "lucide-react";
import { Badge } from "../badge";
import { Button } from "../button";
import { cn } from "@/lib/utils";
import type { DrillDownListDef } from "@/types/components";

export function DrillDownList({
  title,
  description,
  items,
  onViewAll,
}: DrillDownListDef) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div>
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {onViewAll && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onViewAll}
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-border">
        {items.length === 0 && (
          <div className="flex items-center justify-center px-5 py-8 text-sm text-muted-foreground">
            No items to show
          </div>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            onClick={item.onClick}
            role={item.onClick ? "button" : undefined}
            tabIndex={item.onClick ? 0 : undefined}
            onKeyDown={
              item.onClick
                ? (e) => e.key === "Enter" && item.onClick?.()
                : undefined
            }
            className={cn(
              "flex items-center gap-3 px-5 py-3",
              item.onClick &&
                "cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:bg-muted/50"
            )}
          >
            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">
                {item.primary}
              </p>
              {item.secondary && (
                <p className="text-xs text-muted-foreground truncate">
                  {item.secondary}
                </p>
              )}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2 shrink-0">
              {item.meta && (
                <span className="text-xs text-muted-foreground">
                  {item.meta}
                </span>
              )}
              {item.badge && (
                <Badge variant={item.badge.variant} className="text-xs">
                  {item.badge.label}
                </Badge>
              )}
              {item.onClick && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}