"use client"

import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

// Loader variants using CVA for consistent sizing
const loaderVariants = cva(
  // Base styles - circular spinner with border animation
  "animate-spin rounded-full border-2 border-transparent border-t-current",
  {
    variants: {
      size: {
        sm: "h-3 w-3", // Button and inline text
        md: "h-4 w-4", // Default inline usage
        lg: "h-6 w-6", // Emphasis (rare)
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

export interface LoaderProps extends VariantProps<typeof loaderVariants> {
  className?: string
}

/**
 * Loader - Centralized loading spinner component
 *
 * Usage Rules:
 * - Buttons: inline spinner
 * - Input actions: inline
 * - Tables: DO NOT use (use skeleton instead)
 * - Pages: DO NOT use (use skeleton instead)
 * - Cards: DO NOT use (use skeleton instead)
 *
 * @example
 * <Loader size="sm" /> // Button inline
 * <Loader size="md" /> // Default inline
 * <Loader size="lg" /> // Emphasis
 */
export function Loader({ size, className }: LoaderProps) {
  return (
    <div
      className={cn(
        // Use current text color for spinner (adapts to context)
        "text-current",
        loaderVariants({ size }),
        className
      )}
      role="status"
      aria-label="Loading"
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}
