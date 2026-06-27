import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Eye, EyeOff } from "lucide-react"
import { Loader } from "./loader"

// Input variants matching Button system
const inputVariants = cva(
  "flex w-full min-w-0 rounded-lg border border-input bg-background text-base transition-[color,box-shadow,background-color] outline-none file:inline-flex file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        sm: "h-9 px-3 text-sm", // 36px height
        md: "h-11 px-4 text-base", // 44px height (default)
        lg: "h-13 px-6 text-lg", // 52px height
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

export interface InputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> {
  inputSize?: "sm" | "md" | "lg"
  state?: "default" | "error" | "success"
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  loading?: boolean
  showPasswordToggle?: boolean
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      inputSize,
      state,
      leftIcon,
      rightIcon,
      loading = false,
      showPasswordToggle,
      disabled,
      type,
      ...props
    },
    ref
  ) => {
    const [showPassword, setShowPassword] = React.useState(false)
    const showRightIcon = loading || rightIcon || showPasswordToggle

    return (
      <div className="relative w-full">
        {leftIcon && (
          <div className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 transform text-muted-foreground">
            {leftIcon}
          </div>
        )}

        <input
          type={showPassword ? "text" : type || "text"}
          data-slot="input"
          className={cn(
            inputVariants({ size: inputSize, state }),
            leftIcon && "pl-10",
            showRightIcon && "pr-10",
            className
          )}
          ref={ref}
          disabled={disabled || loading}
          {...props}
        />

        {showRightIcon && (
          <div
            className={cn(
              "absolute top-1/2 right-3 -translate-y-1/2 transform text-muted-foreground",
              !showPasswordToggle && "pointer-events-none"
            )}
          >
            {loading ? (
              <Loader size="sm" />
            ) : showPasswordToggle ? (
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="pointer-events-auto rounded p-1 hover:bg-muted-foreground/20"
                tabIndex={-1}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            ) : (
              rightIcon
            )}
          </div>
        )}
      </div>
    )
  }
)
Input.displayName = "Input"

export { Input, inputVariants }
