"use client"

import React from "react"
import { ColumnDef } from "@tanstack/react-table"
import { Switch } from "../switch"
import { Checkbox } from "../checkbox"
import { RadioGroup, RadioGroupItem } from "../radio-group"
import { Label } from "../label"
import { cn } from "@/lib/utils"

// ─── Switch Column ────────────────────────────────────────────────────────────

interface SwitchColumnOptions<TData> {
  header?: string
  /** Accessor key for the boolean field */
  accessorKey: keyof TData & string
  /** Called when toggle changes. Receives row index and new value. */
  onCheckedChange?: (rowIndex: number, checked: boolean, row: TData) => void
  /** Disable the switch for specific rows */
  disabled?: boolean | ((row: TData) => boolean)
  /** Switch size */
  size?: "sm" | "md" | "lg"
  className?: string
}

export function switchColumn<TData>(
  options: SwitchColumnOptions<TData>
): ColumnDef<TData, boolean> {
  const {
    header,
    accessorKey,
    onCheckedChange,
    disabled,
    size = "md",
    className,
  } = options

  return {
    id: accessorKey,
    header: header ?? accessorKey,
    accessorKey,
    meta: { align: "center" },
    cell: ({ row }) => {
      const value = row.getValue(accessorKey) as boolean
      const rowIndex = row.index
      const isDisabled =
        typeof disabled === "function" ? disabled(row.original) : !!disabled

      return (
        <div className={cn("flex justify-center", className)}>
          <Switch
            size={size}
            checked={value ?? false}
            onCheckedChange={(checked) => {
              onCheckedChange?.(rowIndex, checked, row.original)
            }}
            disabled={isDisabled}
            aria-label={`${header ?? accessorKey} toggle`}
          />
        </div>
      )
    },
  }
}

// ─── Checkbox Column ──────────────────────────────────────────────────────────

interface CheckboxColumnOptions<TData> {
  header?: string
  /** Accessor key for the boolean field */
  accessorKey: keyof TData & string
  /** Called when checkbox changes */
  onCheckedChange?: (rowIndex: number, checked: boolean, row: TData) => void
  /** Disable the checkbox for specific rows */
  disabled?: boolean | ((row: TData) => boolean)
  className?: string
}

export function checkboxColumn<TData>(
  options: CheckboxColumnOptions<TData>
): ColumnDef<TData, boolean> {
  const { header, accessorKey, onCheckedChange, disabled, className } = options

  return {
    id: accessorKey,
    header: header ?? accessorKey,
    accessorKey,
    meta: { align: "center" },
    cell: ({ row }) => {
      const value = row.getValue(accessorKey) as boolean
      const rowIndex = row.index
      const isDisabled =
        typeof disabled === "function" ? disabled(row.original) : !!disabled

      return (
        <div className={cn("flex justify-center", className)}>
          <Checkbox
            checked={value ?? false}
            onCheckedChange={(checked) => {
              onCheckedChange?.(rowIndex, checked === true, row.original)
            }}
            disabled={isDisabled}
            aria-label={`${header ?? accessorKey} checkbox`}
          />
        </div>
      )
    },
  }
}

// ─── Radio Column ─────────────────────────────────────────────────────────────

interface RadioOption {
  value: string
  label: string
  disabled?: boolean
}

interface RadioColumnOptions<TData> {
  header?: string
  /** Accessor key for the string field */
  accessorKey: keyof TData & string
  /** Available radio options */
  options: RadioOption[]
  /** Called when radio selection changes */
  onValueChange?: (rowIndex: number, value: string, row: TData) => void
  /** Disable the radio group for specific rows */
  disabled?: boolean | ((row: TData) => boolean)
  /** Render options inline (horizontal) or stacked */
  inline?: boolean
  className?: string
}

export function radioColumn<TData>(
  options: RadioColumnOptions<TData>
): ColumnDef<TData, string> {
  const {
    header,
    accessorKey,
    options: radioOptions,
    onValueChange,
    disabled,
    inline = false,
    className,
  } = options

  return {
    id: accessorKey,
    header: header ?? accessorKey,
    accessorKey,
    meta: { align: "center" },
    cell: ({ row }) => {
      const value = row.getValue(accessorKey) as string
      const rowIndex = row.index
      const isDisabled =
        typeof disabled === "function" ? disabled(row.original) : !!disabled
      const groupName = `radio-${accessorKey}-${row.id}`

      return (
        <RadioGroup
          value={value ?? ""}
          onValueChange={(val) => {
            onValueChange?.(rowIndex, val, row.original)
          }}
          disabled={isDisabled}
          className={cn(
            inline ? "flex flex-row flex-wrap gap-3" : "flex flex-col gap-1",
            className
          )}
        >
          {radioOptions.map((opt) => (
            <div key={opt.value} className="flex items-center gap-1.5">
              <RadioGroupItem
                value={opt.value}
                id={`${groupName}-${opt.value}`}
                disabled={opt.disabled}
              />
              <Label
                htmlFor={`${groupName}-${opt.value}`}
                className="text-xs font-normal cursor-pointer"
              >
                {opt.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      )
    },
  }
}
