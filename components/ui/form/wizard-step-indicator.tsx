"use client"

import React, { useEffect, useState } from "react"
import { Check, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { WizardStep } from "@/types/components"

interface WizardStepIndicatorProps {
  steps: WizardStep[]
  currentStep: number
}

const ENCOURAGEMENTS = [
  "Great start!",
  "Nice work!",
  "Keep going!",
  "Almost there!",
  "You're a natural!",
  "Looking good!",
  "Fantastic!",
  "Nailed it!",
]

export function WizardStepIndicator({ steps, currentStep }: WizardStepIndicatorProps) {
  const [showCelebration, setShowCelebration] = useState(false)
  const [completedStep, setCompletedStep] = useState<number | null>(null)

  useEffect(() => {
    if (currentStep > 0) {
      setCompletedStep(currentStep - 1)
      setShowCelebration(true)
      const timer = setTimeout(() => setShowCelebration(false), 1800)
      return () => clearTimeout(timer)
    }
  }, [currentStep])

  const progress = steps.length > 1 ? (currentStep / (steps.length - 1)) * 100 : 0

  return (
    <div className="w-full space-y-3">
      {/* Progress bar */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, #58CC02, #7AC943, #58CC02)",
          }}
        />
        {/* Shine effect */}
        <div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-full transition-all duration-700 ease-out"
          style={{ width: `${progress}%` }}
        >
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)",
            }}
          />
        </div>
      </div>

      {/* Step count */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Step {currentStep + 1} of {steps.length}
        </span>
        {showCelebration && completedStep !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold text-primary",
              "animate-[slideUp_0.3s_ease-out,fadeOut_0.3s_1.5s_ease-out_forwards]"
            )}
          >
            <Sparkles className="h-3 w-3" />
            {steps[completedStep]?.completionMessage ??
              ENCOURAGEMENTS[completedStep % ENCOURAGEMENTS.length]}
          </span>
        )}
      </div>

      {/* Step dots with emojis */}
      <div className="flex items-center gap-1">
        {steps.map((step, i) => {
          const isDone = i < currentStep
          const isActive = i === currentStep
          const justCompleted = showCelebration && i === completedStep

          return (
            <React.Fragment key={step.id}>
              {/* Step node */}
              <div className="flex flex-col items-center gap-1.5 shrink-0">
                <div
                  className={cn(
                    "relative flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-bold transition-all duration-500",
                    isDone &&
                      "border-primary bg-primary text-primary-foreground scale-100",
                    isActive &&
                      "border-primary bg-background text-primary scale-110 shadow-[0_0_0_4px_rgba(88,204,2,0.15)]",
                    !isDone &&
                      !isActive &&
                      "border-border bg-background text-muted-foreground",
                    justCompleted && "animate-[bounce_0.5s_ease-in-out]"
                  )}
                >
                  {isDone ? (
                    <Check className="h-5 w-5" strokeWidth={3} />
                  ) : step.icon ? (
                    <span className="text-base">{step.icon}</span>
                  ) : (
                    i + 1
                  )}

                  {/* Sparkle burst on completion */}
                  {justCompleted && (
                    <div className="absolute inset-0 pointer-events-none">
                      {[...Array(6)].map((_, j) => (
                        <span
                          key={j}
                          className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-primary"
                          style={{
                            animation: `sparkle 0.6s ease-out ${j * 0.05}s forwards`,
                            transform: `rotate(${j * 60}deg) translateY(-${12 + j * 2}px)`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium max-w-[64px] text-center leading-tight transition-colors",
                    isActive
                      ? "text-primary font-semibold"
                      : isDone
                        ? "text-foreground"
                        : "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
              </div>

              {/* Connector line */}
              {i < steps.length - 1 && (
                <div className="flex-1 flex items-end mb-6">
                  <div
                    className={cn(
                      "h-1 w-full rounded-full transition-colors duration-500",
                      i < currentStep ? "bg-primary" : "bg-border"
                    )}
                  />
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}
