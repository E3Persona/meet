"use client"

import * as React from "react"
import PhoneInputWithCountry, { type Country } from "react-phone-number-input"
import "react-phone-number-input/style.css"
import { cn } from "@/lib/utils"

export interface PhoneInputProps {
  value?: string
  onChange?: (value: string) => void
  defaultCountry?: Country
  placeholder?: string
  id?: string
  disabled?: boolean
  error?: boolean
  className?: string
}

function PhoneInput({
  value,
  onChange,
  defaultCountry = "US",
  placeholder,
  id,
  disabled,
  error,
  className,
}: PhoneInputProps) {
  const handleChange = React.useCallback(
    (val?: string) => {
      onChange?.(val ?? "")
    },
    [onChange]
  )

  return (
    <PhoneInputWithCountry
      international
      withCountryCallingCode
      defaultCountry={defaultCountry}
      value={value}
      onChange={handleChange}
      placeholder={placeholder}
      id={id}
      disabled={disabled}
      className={cn(
        "flex h-11 w-full rounded-lg border border-input bg-background text-base transition-[color,box-shadow,background-color] outline-none",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        error && "border-destructive focus-visible:ring-destructive/30",
        className
      )}
      numberInputProps={{
        className: "h-11 flex-1 bg-transparent outline-none border-none px-3",
      }}
      countrySelectProps={{
        className: "h-11",
      }}
    />
  )
}

export { PhoneInput }
