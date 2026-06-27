import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 font-medium whitespace-nowrap",
  {
    variants: {
      variant: {
        success: "border border-emerald-200 bg-emerald-50 text-emerald-700",
        warning: "border border-amber-200 bg-amber-50 text-amber-700",
        error: "border border-red-200 bg-red-50 text-red-700",
        neutral: "border border-gray-200 bg-gray-50 text-gray-700",
        info: "border border-blue-200 bg-blue-50 text-blue-700",
        outline: "border border-gray-300 bg-transparent text-gray-700",
        purple: "border border-purple-200 bg-purple-50 text-purple-700",
        indigo: "border border-indigo-200 bg-indigo-50 text-indigo-700",
      },
      size: {
        sm: "rounded-md px-2 py-0.5 text-xs",
        md: "rounded-md px-2.5 py-1 text-sm",
      },
      dot: {
        true: "",
        false: "",
      },
      removable: {
        true: "pr-1",
        false: "",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm",
      dot: false,
      removable: false,
    },
  }
)

const dotColorMap: Record<string, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
  neutral: "bg-gray-500",
  info: "bg-blue-500",
  outline: "bg-gray-400",
  purple: "bg-purple-500",
  indigo: "bg-indigo-500",
}

export interface BadgeProps
  extends React.ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  icon?: React.ElementType
  onRemove?: () => void
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  (
    {
      className,
      variant,
      size,
      dot = false,
      removable = false,
      icon: Icon,
      onRemove,
      children,
      ...props
    },
    ref
  ) => {
    return (
      <span
        ref={ref}
        data-slot="badge"
        data-variant={variant}
        className={cn(
          badgeVariants({ variant, size, dot, removable }),
          className
        )}
        {...props}
      >
        {dot && (
          <span
            className={cn(
              "h-1.5 w-1.5 flex-shrink-0 rounded-full",
              variant && dotColorMap[variant]
            )}
          />
        )}
        {Icon && <Icon className="h-3.5 w-3.5 flex-shrink-0" />}
        {children}
        {removable && onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className={cn(
              "-mr-0.5 ml-0.5 flex h-4 w-4 items-center justify-center rounded-full hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-1",
              variant === "success" && "hover:bg-emerald-200",
              variant === "warning" && "hover:bg-amber-200",
              variant === "error" && "hover:bg-red-200",
              variant === "info" && "hover:bg-blue-200",
              variant === "purple" && "hover:bg-purple-200",
              variant === "indigo" && "hover:bg-indigo-200"
            )}
          >
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
            <span className="sr-only">Remove</span>
          </button>
        )}
      </span>
    )
  }
)
Badge.displayName = "Badge"

export { Badge, badgeVariants }
