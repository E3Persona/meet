"use client"

import React from "react"
import { cn } from "@/lib/utils"
import { Input } from "../input"
import { Textarea } from "../textarea"
import { Label } from "../label"
import { Switch } from "../switch"
import { Checkbox } from "../checkbox"
import { RadioGroup, RadioGroupItem } from "../radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "../select"
import { Badge } from "../badge"
import { AlertCircle, X } from "lucide-react"
import { AppIcon, IconText } from "../icon"
import { Text } from "../text"

import { FileUpload, FileUploadProps } from "./file-upload"
import { PhoneInput } from "../phone-input"
import { COL_SPAN_CLASS } from "@/lib/constants/form"
import { FieldDef, SelectOption, UploadedFile } from "@/types/components/forms"
import { ColSpan } from "@/types/components/forms"

// ─── Shared Field Wrapper ─────────────────────────────────────────────────────

interface FieldWrapperProps {
  label: string
  required?: boolean
  helperText?: string
  error?: string
  children: React.ReactNode
  className?: string
  htmlFor?: string
}

export function FieldWrapper({
  label,
  required,
  helperText,
  error,
  children,
  className,
  htmlFor,
}: FieldWrapperProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label
        htmlFor={htmlFor}
        className={cn(
          "text-sm font-medium text-foreground",
          required && "after:ml-0.5 after:text-destructive after:content-['*']"
        )}
      >
        <Text variant="label" as="span">
          {label}
        </Text>
      </Label>
      {children}
      {helperText && !error && (
        <Text variant="bodyMuted" className="text-xs">
          {helperText}
        </Text>
      )}
      {error && (
        <IconText
          icon={AlertCircle}
          iconSize="xs"
          spacing="xs"
          className="text-xs text-destructive"
        >
          {error}
        </IconText>
      )}
    </div>
  )
}

// ─── Multi-select component ───────────────────────────────────────────────────

interface MultiSelectInputProps {
  options: SelectOption[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  disabled?: boolean
  id?: string
}

function MultiSelectInput({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: MultiSelectInputProps) {
  const selected = value ?? []

  const toggle = (v: string) => {
    onChange(
      selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]
    )
  }

  const remove = (v: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(selected.filter((s) => s !== v))
  }

  const selectedOptions = options.filter((o) => selected.includes(o.value))

  return (
    <div className="relative">
      {selectedOptions.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selectedOptions.map((o) => (
            <Badge
              key={o.value}
              variant="outline"
              size="sm"
              className="flex items-center gap-1 pr-1 pl-2"
            >
              {o.label}
              <button
                type="button"
                onClick={(e) => remove(o.value, e)}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20"
              >
                <AppIcon icon={X} size="xs" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Select onValueChange={toggle} disabled={disabled}>
        <SelectTrigger id={id} placeholder={placeholder ?? "Select options..."} />
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={selected.includes(o.value)}
                  className="pointer-events-none"
                  aria-hidden
                />
                {o.label}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ─── Render a single field ────────────────────────────────────────────────────

export interface RenderFieldProps {
  field: FieldDef
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  fileUploadProps?: Partial<FileUploadProps>
}

export function FormField({
  field,
  value,
  onChange,
  error,
  fileUploadProps,
}: RenderFieldProps) {
  const id = `field-${field.name}`
  const colClass = COL_SPAN_CLASS[(field.colSpan as ColSpan) ?? 2]

  const state = error ? "error" : "default"
  const size = "sm" as const

  const inner = (() => {
    switch (field.type) {
      case "text":
      case "email":
      case "number":
      case "password":
        return (
          <Input
            id={id}
            type={field.type}
            placeholder={field.placeholder}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            state={state}
            inputSize={size}
            showPasswordToggle={field.type === "password"}
          />
        )

      case "phone":
        return (
          <PhoneInput
            id={id}
            placeholder={field.placeholder ?? "+1 (555) 000-0000"}
            value={(value as string) ?? ""}
            onChange={onChange}
            disabled={field.disabled}
            error={!!error}
          />
        )

      case "textarea":
        return (
          <Textarea
            id={id}
            placeholder={field.placeholder}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            rows={
              typeof field.rows === "string"
                ? parseInt(field.rows, 10)
                : (field.rows ?? 3)
            }
            state={state}
            size={size}
          />
        )

      case "select":
        return (
          <Select
            value={(value as string) ?? ""}
            onValueChange={onChange}
            disabled={field.disabled}
            key={`${field.name}-${(value as string) ?? ""}`}
          >
            <SelectTrigger id={id} state={state} size="sm" placeholder={field.placeholder ?? "Select..."} />
            <SelectContent>
              {field.options.map((o: SelectOption) => (
                <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )

      case "multi-select":
        return (
          <MultiSelectInput
            id={id}
            options={field.options}
            value={(value as string[]) ?? []}
            onChange={(v) => onChange(v)}
            placeholder={field.placeholder}
            disabled={field.disabled}
          />
        )

      case "radio":
        return (
          <RadioGroup
            value={(value as string) ?? ""}
            onValueChange={onChange}
            disabled={field.disabled}
            className={cn("gap-2", field.inline && "flex flex-row flex-wrap")}
          >
            {field.options.map((o: SelectOption) => (
              <div key={o.value} className="flex items-center gap-2">
                <RadioGroupItem value={o.value} id={`${id}-${o.value}`} />
                <Label
                  htmlFor={`${id}-${o.value}`}
                  className={cn("text-sm font-medium text-foreground")}
                >
                  <Text variant="label" as="span">
                    {o.label}
                  </Text>
                </Label>
              </div>
            ))}
          </RadioGroup>
        )

      case "checkbox":
        return (
          <div className="flex h-9 items-center gap-2">
            <Checkbox
              id={id}
              checked={(value as boolean) ?? false}
              onCheckedChange={(v) => onChange(v === true)}
              disabled={field.disabled}
            />
            {field.checkboxLabel && (
              <Label
                htmlFor={id}
                className={cn("text-sm font-medium text-foreground")}
              >
                <Text variant="body" as="span">
                  {field.checkboxLabel}
                </Text>
              </Label>
            )}
          </div>
        )

      case "toggle":
        return (
          <div className="flex h-9 items-center gap-3">
            <Switch
              id={id}
              checked={(value as boolean) ?? false}
              onCheckedChange={onChange}
              disabled={field.disabled}
            />
            {field.toggleLabel && (
              <Label
                htmlFor={id}
                className="cursor-pointer text-sm font-normal"
              >
                <Text variant="body">{field.toggleLabel}</Text>
              </Label>
            )}
          </div>
        )

      case "date":
      case "datetime":
        return (
          <Input
            id={id}
            type={field.type === "datetime" ? "datetime-local" : "date"}
            value={(value as string) ?? ""}
            onChange={(e) => onChange(e.target.value)}
            disabled={field.disabled}
            state={state}
            inputSize={size}
          />
        )

      case "file":
        return (
          <FileUpload
            accept={field.accept}
            multiple={field.multiple ?? true}
            maxFiles={field.maxFiles}
            maxSizeMB={field.maxSizeMB}
            existingUrls={field.existingUrls}
            error={error}
            // Pass controlled files from form state down so previews survive re-renders
            files={(value as UploadedFile[]) ?? []}
            // Propagate the full UploadedFile array up so form state stays in sync
            onFilesChange={onChange}
            {...fileUploadProps}
          />
        )

      case "custom":
        return field.render ? field.render({ value, onChange, error }) : null

      default:
        return null
    }
  })()

  // File fields manage their own error display inside FileUpload
  if (field.type === "file") {
    return (
      <div className={colClass}>
        <FieldWrapper
          label={field.label}
          required={field.required}
          helperText={field.helperText}
          htmlFor={id}
        >
          {inner}
        </FieldWrapper>
      </div>
    )
  }

  return (
    <div className={colClass}>
      <FieldWrapper
        label={field.label}
        required={field.required}
        helperText={field.helperText}
        error={error}
        htmlFor={id}
      >
        {inner}
      </FieldWrapper>
    </div>
  )
}