"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Switch as SwitchPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

const switchVariants = cva(
  "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 data-checked:border-primary data-checked:bg-primary data-unchecked:border-transparent data-unchecked:bg-input/90 data-disabled:cursor-not-allowed data-disabled:opacity-50",
  {
    variants: {
      size: {
        sm: "h-4 w-7",
        md: "h-5 w-11",
        lg: "h-6 w-14",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

const thumbVariants = cva(
  "pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform dark:bg-clip-padding",
  {
    variants: {
      size: {
        sm: "h-3 w-4 group-data-[size=sm]/switch:h-3 group-data-[size=sm]/switch:w-4 group-data-checked:translate-x-[calc(100%-6px)] group-data-unchecked:translate-x-0 dark:group-data-checked:bg-primary-foreground dark:group-data-unchecked:bg-foreground",
        md: "h-4 w-6 group-data-[size=md]/switch:h-4 group-data-[size=md]/switch:w-6 group-data-checked:translate-x-[calc(100%-8px)] group-data-unchecked:translate-x-0 dark:group-data-checked:bg-primary-foreground dark:group-data-unchecked:bg-foreground",
        lg: "h-5 w-7 group-data-[size=lg]/switch:h-5 group-data-[size=lg]/switch:w-7 group-data-checked:translate-x-[calc(100%-10px)] group-data-unchecked:translate-x-0 dark:group-data-checked:bg-primary-foreground dark:group-data-unchecked:bg-foreground",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

export interface SwitchProps
  extends
    React.ComponentProps<typeof SwitchPrimitive.Root>,
    VariantProps<typeof switchVariants> {
  label?: string
  description?: string
  error?: string
}

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(
  (
    { className, size = "md", label, description, error, id, ...props },
    ref
  ) => {
    const switchId = id || React.useId()
    const descriptionId = `${switchId}-desc`
    const errorId = `${switchId}-error`

    const switchElement = (
      <SwitchPrimitive.Root
        ref={ref}
        id={switchId}
        data-slot="switch"
        data-size={size}
        aria-describedby={
          error ? errorId : description ? descriptionId : undefined
        }
        aria-invalid={!!error || undefined}
        className={cn(switchVariants({ size }), className)}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(thumbVariants({ size }))}
        />
      </SwitchPrimitive.Root>
    )

    if (!label && !description && !error) {
      return switchElement
    }

    return (
      <div className="flex items-start gap-3">
        <div className="flex items-center pt-0.5">{switchElement}</div>
        <div className="flex flex-col gap-0.5">
          {label && (
            <label
              htmlFor={switchId}
              className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              {label}
            </label>
          )}
          {description && (
            <p id={descriptionId} className="text-xs text-muted-foreground">
              {description}
            </p>
          )}
          {error && (
            <p id={errorId} className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    )
  }
)
Switch.displayName = "Switch"

export { Switch, switchVariants }
