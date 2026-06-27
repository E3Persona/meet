"use client"

import * as React from "react"
import { cn } from "../../lib/utils"
import { Check } from "lucide-react"

export interface ColorOption {
  name: string
  hex: string
}

interface ColorPickerProps {
  colors: readonly ColorOption[]
  value: string
  onChange: (hex: string) => void
  className?: string
  columns?: number
}

export function ColorPicker({
  colors,
  value,
  onChange,
  className,
  columns = 4,
}: ColorPickerProps) {
  return (
    <div className={cn("grid gap-2", className)} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {colors.map((color) => {
        const isSelected = value === color.hex
        return (
          <button
            key={color.hex}
            type="button"
            onClick={() => onChange(color.hex)}
            className={cn(
              "relative flex aspect-square items-center justify-center rounded-lg border-2 transition-all hover:scale-105",
              isSelected ? "border-foreground ring-2 ring-foreground/20" : "border-transparent hover:border-foreground/30"
            )}
            style={{ backgroundColor: color.hex }}
            title={color.name}
          >
            {isSelected && (
              <Check className="h-5 w-5 text-white drop-shadow-md" strokeWidth={3} />
            )}
          </button>
        )
      })}
    </div>
  )
}
