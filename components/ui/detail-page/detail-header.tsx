"use client"

import { Badge } from "../badge"
import { Button } from "../button"
import { Separator } from "../separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../dropdown-menu"
import { MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { DetailAction, StatusBadge } from "@/types/components"
import { Text } from "../text"

interface DetailHeaderProps {
  title: string
  subtitle?: string
  status?: StatusBadge
  primaryActions?: DetailAction[]
  secondaryActions?: DetailAction[]
  /** Max visible primary action buttons before overflow menu */
  maxVisibleActions?: number
  className?: string
}

export function DetailHeader({
  title,
  subtitle,
  status,
  primaryActions = [],
  secondaryActions = [],
  maxVisibleActions = 3,
  className,
}: DetailHeaderProps) {
  const visibleActions = primaryActions.slice(0, maxVisibleActions)
  const overflowActions = primaryActions.slice(maxVisibleActions)
  const allOverflow = [...overflowActions, ...secondaryActions]

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-start justify-between gap-4">
        {/* Left: title block */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Text variant="h2">{title}</Text>
            {status && (
              <Badge
                variant={
                  status.variant === "success" ||
                  status.variant === "warning" ||
                  status.variant === "error" ||
                  status.variant === "info"
                    ? status.variant
                    : "neutral"
                }
                className="shrink-0"
              >
                {status.label}
              </Badge>
            )}
          </div>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>

        {/* Right: actions */}
        {(visibleActions.length > 0 || allOverflow.length > 0) && (
          <div className="flex shrink-0 items-center gap-2">
            {visibleActions.map((action, i) => (
              <Button
                key={i}
                variant={
                  action.variant === "default"
                    ? "secondary"
                    : action.variant === "ghost"
                      ? "subtle"
                      : (action.variant ?? "outline")
                }
                size="sm"
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.icon && <span className="mr-1.5">{action.icon}</span>}
                {action.label}
              </Button>
            ))}
            {allOverflow.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="px-2">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {allOverflow.map((action, i) => (
                    <DropdownMenuItem
                      key={i}
                      onClick={action.onClick}
                      disabled={action.disabled}
                      className={cn(
                        action.variant === "destructive" &&
                          "text-destructive focus:text-destructive"
                      )}
                    >
                      {action.icon && (
                        <span className="mr-2">{action.icon}</span>
                      )}
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
      <Separator />
    </div>
  )
}
