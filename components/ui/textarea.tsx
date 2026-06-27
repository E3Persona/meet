import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// Textarea variants matching Button system
const textareaVariants = cva(
  "flex field-sizing-content w-full resize-none rounded-lg border border-input bg-background text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        sm: "min-h-20 px-3 py-2 text-sm", // Compact textarea
        md: "min-h-24 px-4 py-3 text-base", // Default textarea
        lg: "min-h-32 px-6 py-4 text-lg", // Large textarea
      },
      state: {
        default: "border-input",
        error: "border-destructive focus-visible:ring-destructive/30",
        success: "border-green-500 focus-visible:ring-green-500/30",
      },
    },
    defaultVariants: {
      size: "md",
      state: "default",
    },
  }
)

export interface TextareaProps
  extends
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    VariantProps<typeof textareaVariants> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, size, state, ...props }, ref) => {
    return (
      <textarea
        data-slot="textarea"
        className={cn(textareaVariants({ size, state }), className)}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea, textareaVariants }
