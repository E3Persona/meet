import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"
import { AppIcon, ICON_CONTEXT_SIZES } from "./icon"

// Button variants with new design system
const buttonVariants = cva(
  // Base styles - consistent with system design
  "flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/95",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 active:bg-secondary/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        subtle:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
        destructive:
          "text-destructive-foreground bg-destructive hover:bg-destructive/90 active:bg-destructive/95",
        text: "text-foreground hover:bg-accent/50 active:bg-accent/70",
        ghost:
          "hover:bg-accent hover:text-accent-foreground active:bg-accent/80",
      },
      size: {
        sm: "h-9 px-3 text-sm", // 36px height
        md: "h-11 px-4 text-base", // 44px height (default)
        lg: "h-13 px-6 text-lg", // 52px height
        icon: "h-11 w-11", // Square, same height as md
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  loading?: boolean
  leftIcon?: React.ElementType
  rightIcon?: React.ElementType
  fullWidth?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      fullWidth,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button"

    // Determine icon context based on button size
    const getIconContext = (buttonSize?: string | null | undefined) => {
      switch (buttonSize) {
        case "sm":
          return "button_secondary" as const
        case "lg":
          return "button_primary" as const
        case "icon":
          return "button_primary" as const
        default:
          return "button_primary" as const
      }
    }

    // Left content: always render slot to avoid DOM mismatch
    const leftContent = loading ? (
      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
    ) : leftIcon ? (
      <AppIcon icon={leftIcon} context={getIconContext(size)} />
    ) : null

    // Icon-only button handling
    const isIconOnly = !children && !leftContent && !rightIcon

    return (
      <Comp
        className={cn(
          buttonVariants({ variant, size }),
          isIconOnly && "p-0",
          fullWidth && "w-full",
          className
        )}
        ref={ref}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            <span className={!leftContent ? "hidden" : undefined}>
              {leftContent}
            </span>
            {children && !isIconOnly && children}
            {rightIcon && !loading && (
              <AppIcon icon={rightIcon} context={getIconContext(size)} />
            )}
          </>
        )}
      </Comp>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
