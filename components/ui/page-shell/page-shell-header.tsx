// components/page-shell/page-shell-header.tsx

"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "../button";
import { cn } from "@/lib/utils";
import { AppIcon } from "../icon";
import { Text } from "../text";

interface PageShellHeaderProps {
  title: string;
  description?: string;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  actions?: React.ReactNode;
  className?: string;
}

export function PageShellHeader({
  title,
  description,
  onRefresh,
  isRefreshing,
  actions,
  className,
}: PageShellHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6",
        className
      )}
    >
      <div className="flex flex-col gap-0.5">
        <Text variant="h2" className="text-xl font-semibold tracking-tight text-foreground" as="h1">
          {title}
        </Text>
        {description && (
          <Text variant="bodyMuted" className="text-sm">
            {description}
          </Text>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2"
            aria-label="Refresh page"
          >
            <AppIcon 
              icon={RefreshCw}
              size="sm"
              className={cn(isRefreshing && "animate-spin")}
            />
            <Text variant="button" className="hidden sm:inline">Refresh</Text>
          </Button>
        )}
      </div>
    </div>
  );
}