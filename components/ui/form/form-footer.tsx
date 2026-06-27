"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Button } from "../button"
import { ArrowLeft, ArrowRight } from "lucide-react"

interface FormFooterProps {
  primaryLabel?: string
  secondaryLabel?: string
  onPrimary?: () => void
  onSecondary?: () => void
  isLoading?: boolean
  isDisabled?: boolean
  /** "sticky" keeps the footer fixed at the bottom of the form container */
  sticky?: boolean
  className?: string
  /** Wizard: show Back button */
  showBack?: boolean
  onBack?: () => void
  /** Wizard: show Next instead of Submit */
  showNext?: boolean
  onNext?: () => void
  /** Make primary button full width when alone */
  primaryFullWidth?: boolean
}

export function FormFooter({
  primaryLabel = "Save",
  secondaryLabel = "Cancel",
  onPrimary,
  onSecondary,
  isLoading,
  isDisabled,
  sticky,
  className,
  showBack,
  onBack,
  showNext,
  onNext,
  primaryFullWidth,
}: FormFooterProps) {
  const hasLeft = !!showBack
  const hasRight = !!onSecondary || !!showNext || !!onPrimary

  return (
    <div
      className={cn(
        "flex items-center gap-3 pt-4",
        hasLeft && hasRight && "justify-between",
        !hasLeft && hasRight && "justify-end",
        !hasLeft && !hasRight && "justify-center",
        sticky && "sticky bottom-0 pb-4 px-0 mt-4",
        className,
      )}
    >
      {/* Left: Back (wizard) */}
      {hasLeft && (
        <div>
          <Button
            type="button"
            variant="text"
            onClick={onBack}
            disabled={isLoading}
            leftIcon={ArrowLeft}
          >
            Back
          </Button>
        </div>
      )}

      {/* Right: Cancel + Primary */}
      <div
        className={cn(
          "flex items-center gap-2",
          primaryFullWidth && !showNext && "flex-1",
        )}
      >
        {onSecondary && (
          <Button
            type="button"
            variant="outline"
            onClick={onSecondary}
            disabled={isLoading}
            className="min-w-[80px]"
          >
            {secondaryLabel}
          </Button>
        )}

        {showNext ? (
          <Button
            type="button"
            onClick={onNext}
            disabled={isLoading || isDisabled}
            loading={isLoading}
            rightIcon={ArrowRight}
          >
            Next
          </Button>
        ) : (
          <Button
            type={onPrimary ? "button" : "submit"}
            onClick={onPrimary}
            disabled={isDisabled}
            loading={isLoading}
            className={cn(primaryFullWidth && "flex-1")}
          >
            {primaryLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
