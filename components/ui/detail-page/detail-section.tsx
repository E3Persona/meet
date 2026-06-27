// import { DetailAction, DetailField } from "@/types/components";
import { cn } from "@/lib/utils"
import { ReactNode } from "react"
import { Button } from "../button"
import { FieldItem } from "./field-item"
import { DetailAction, DetailField } from "@/types/components"

interface DetailSectionProps {
  title: string
  description?: string
  action?: DetailAction
  fields?: DetailField[]
  children?: ReactNode
  className?: string
  /** Layout for fields: grid (default) or list */
  fieldLayout?: "grid" | "list"
}

export function DetailSection({
  title,
  description,
  action,
  fields,
  children,
  className,
  fieldLayout = "grid",
}: DetailSectionProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {/* Section header */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action && (
          <Button
            variant={
              action.variant === "default"
                ? "secondary"
                : action.variant === "ghost"
                  ? "subtle"
                  : (action.variant ?? "subtle")
            }
            size="sm"
            onClick={action.onClick}
            disabled={action.disabled}
            className="h-7 shrink-0 text-xs"
          >
            {action.icon && <span className="mr-1">{action.icon}</span>}
            {action.label}
          </Button>
        )}
      </div>

      {/* Fields */}
      {fields && fields.length > 0 && (
        <div
          className={cn(
            fieldLayout === "grid"
              ? "grid grid-cols-2 gap-x-6 gap-y-3"
              : "space-y-3"
          )}
        >
          {fields.map((field, i) => (
            <div
              key={i}
              className={cn(
                fieldLayout === "grid" && field.span === 2 && "col-span-2"
              )}
            >
              <FieldItem {...field} />
            </div>
          ))}
        </div>
      )}

      {/* Arbitrary children */}
      {children}
    </div>
  )
}
